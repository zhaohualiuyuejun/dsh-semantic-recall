/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/*`（拿不到就退到自己的依赖）
 *
 * 背景（照抄 dsh-bili-scroll 2026-10-16 的事故结论）：
 *   桌面版 profile 是 autoInstallPeers:false ⇒ optional peer 永远不会被装
 *   ⇒ 裸 import `@deepseek-ai/schemastery` 会让整条插件不激活。
 * 策略：
 *   ① 优先从宿主树解析（跟宿主用同一份）；
 *   ② 解析不到就 bare import（靠 package.json 的 dependencies 保底）；
 *   ③ schemastery 彻底拿不到 ⇒ 返回 null，插件照常加载，只是没有 Config / 设置页降级。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  push(SELF_MODULES)
  return out
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

async function fromHostTree(name, log) {
  const fails = []
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(`${name}：从宿主树取到`)
      return mod
    } catch (e) { fails.push(`${e?.code || 'ERR'}:${root}`) }
  }
  if (fails.length) log(`${name}：宿主树里都不行（${fails.slice(0, 3).join(' ')}）`)
  return null
}

/**
 * 把隐式参数表（ParameterSchemaSpec）编译成 object 根 JSON Schema。
 * 与宿主 rc.5 的 parameterSchemaSpecToJsonSchema 等价：属性上的 `required: true` 表示必填。
 * ⚠️ 编译出来的根节点**不带** additionalProperties（宿主也不带）。
 */
export function compileParameterSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, node] of Object.entries(spec || {})) {
    if (!node || typeof node !== 'object') continue
    const { required: isRequired, ...rest } = node
    properties[key] = rest
    if (isRequired === true) required.push(key)
  }
  const schema = { type: 'object', properties }
  if (required.length) schema.required = required
  return schema
}

/**
 * 宿主的 dsh-tools 拿不到时的本地等价实现。
 * 输入是隐式参数表（{ query: { type:'string' } }），返回编译好的 object 根 JSON Schema。
 * 不编译的话，模型请求里 tools[].function.parameters 没有 type ⇒ 整批工具定义非法 ⇒ 所有对话 400。
 */
function localDefineTool(options, log) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  const parameters = compileParameterSchema(options.parameters)
  // 根节点故意不带 additionalProperties —— 只逐属性校验，别拿根节点去卡。
  for (const [k, v] of Object.entries(parameters.properties)) check(v, `parameters.properties.${k}`)
  check(options.output?.schema, 'output.schema')
  log?.(`dsh-tools 拿不到 —— 用本地等价实现顶上（工具 ${options.name}，parameters 已编译为 object 根）`)
  return { ...options, parameters }
}

export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)

  let zMod = await fromHostTree('schemastery', log)
  if (!zMod) {
    try { zMod = await import('@deepseek-ai/schemastery'); log('schemastery：用自己依赖里那份') }
    catch (e) { log(`⚠️ schemastery 拿不到（${e?.code || ''}）—— 没有 Config，设置页降级`) }
  }
  const z = zMod?.default ?? zMod ?? null

  let defineTool = null
  let defineToolKind = 'host'
  let dtMod = await fromHostTree('dsh-tools', log)
  if (!dtMod) {
    try { dtMod = await import('@deepseek-ai/dsh-tools'); log('dsh-tools：用自己依赖里那份') }
    catch { dtMod = null }
  }
  if (dtMod?.defineTool) {
    defineTool = dtMod.defineTool
  } else {
    defineToolKind = 'local-fallback'
    defineTool = (options) => localDefineTool(options, log)
    // 降级要能被看见：宿主工具契约若再变，现场至少有一行日志
    try { console.warn('[session-recall] 宿主 @deepseek-ai/dsh-tools 不可用，改用本地等价 defineTool（参数表已编译为 object 根）') } catch { /* 没有 console 就算了 */ }
  }

  return { z, defineTool, defineToolKind, notes }
}
