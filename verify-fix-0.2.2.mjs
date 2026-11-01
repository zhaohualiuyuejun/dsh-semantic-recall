/**
 * tools/verify-fix-0.2.2.mjs —— 验证 0.2.2 的两处修复（不联网、不碰真实会话）
 *
 *   1) 工具定义：4 个工具的 parameters 必须是 object 根（否则整批 tools 非法 → 对话 400）
 *   2) 嵌入清洗：落单代理项被替换；批量 400 时逐条重试、坏块用 null 占位
 *
 * 跑法：node tools/verify-fix-0.2.2.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const url = (...p) => pathToFileURL(join(root, ...p)).href

let fail = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fail++
}

// ---------------------------------------------------------------- 1. 工具定义
const { compileParameterSchema } = await import(url('lib', 'hostdeps.mjs'))

const compiled = compileParameterSchema({
  query: { type: 'string', required: true, description: 'x' },
  days: { type: 'number' },
})
ok(compiled.type === 'object', 'compileParameterSchema 产出 object 根')
ok(JSON.stringify(compiled.properties.query) === JSON.stringify({ type: 'string', description: 'x' }),
  '属性里的 required 标记被剥掉')
ok(JSON.stringify(compiled.required) === JSON.stringify(['query']), 'required 提升到根节点')
ok(compiled.additionalProperties === undefined, '根节点不带 additionalProperties（与宿主一致）')

// 真实加载插件，抓注册进来的工具定义
const registered = []
const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  tools: { register: (def) => { registered.push(def); return () => {} } },
  settings: { describe: () => [], update: () => {} },
  webServer: { register: () => () => {} },
  get: () => undefined,
  effect: () => {},
}
const mod = await import(url('index.js'))
const dispose = await mod.apply(ctx, { enabled: false, autoIndex: false, daySummaries: false })

ok(registered.length > 0, `插件注册了工具（${registered.length} 个）`)
for (const d of registered) {
  const p = d.parameters
  const good = p && p.type === 'object' && p.properties && typeof p.properties === 'object'
  ok(good, `工具 ${d.name} 的 parameters 是 object 根`, good ? Object.keys(p.properties).join(',') : JSON.stringify(p)?.slice(0, 80))
}
if (typeof dispose === 'function') dispose()

// ---------------------------------------------------------------- 2. 嵌入清洗与降级
const { sanitizeText } = await import(url('lib', 'embed.mjs'))
const lone = '正常文本\ud83d结尾' // 半个 emoji（落单高位代理）
const fixed = sanitizeText(lone)
ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fixed), 'sanitizeText 清掉落单代理项')
ok(fixed.includes('\uFFFD'), '被替换为 U+FFFD')

// 造一个假的云端接口：整批 400，逐条时只有坏块 400
const realFetch = globalThis.fetch
const calls = []
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  calls.push(Array.isArray(body.input) ? body.input.length : -1)
  const inputs = Array.isArray(body.input) ? body.input : [body.input]
  const hasLone = inputs.some((t) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t))
  const batch = inputs.length > 1
  const bad = hasLone || (batch && process.env.FAKE_FORCE_BATCH_400 === '1') || inputs.some((t) => t.includes('坏'))
  if (bad) {
    return new Response(JSON.stringify({ code: 20015, message: 'The parameter is invalid.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const data = inputs.map((_, i) => ({ index: i, embedding: [0.6, 0.8] }))
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

try {
  const { embedDocuments } = await import(url('lib', 'embed.mjs'))
  // 批量被拒 → 逐条重试：坏块拿到 null，好块正常
  process.env.FAKE_FORCE_BATCH_400 = '1'
  calls.length = 0
  const out = await embedDocuments(['甲', '坏', '丙'], { provider: 'cloud', apiKey: 'k', apiBase: 'https://fake.local/v1' })
  ok(out.length === 3, '逐条降级后条数不变', `返回 ${out.length} 条，调用次数 ${calls.length}`)
  ok(Array.isArray(out[0]) && out[0].length === 2, '好块拿到了向量')
  ok(out[1] === null, '服务端拒掉的单块用 null 占位（索引器会落成空向量）')
  ok(Array.isArray(out[2]), '坏块不影响后面的块')
  delete process.env.FAKE_FORCE_BATCH_400

  // 清洗本身就让它不该 400
  calls.length = 0
  const clean = await embedDocuments(['甲\ud83d乙'], { provider: 'cloud', apiKey: 'k', apiBase: 'https://fake.local/v1' })
  ok(clean.length === 1 && calls.length === 1, '洗涤后的单块一次成功、无需降级', `调用 ${calls.length} 次`)
} finally {
  globalThis.fetch = realFetch
}

console.log(fail ? `\n❌ ${fail} 项未通过` : '\n✅ 全部通过')
process.exit(fail ? 1 : 0)
