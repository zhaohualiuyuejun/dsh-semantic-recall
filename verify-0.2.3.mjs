/**
 * tools/verify-0.2.3.mjs —— 验证 0.2.3 的三处行为变化（不联网、不碰真实会话）
 *
 *   1) 默认包含活跃会话（旧版默认整场排除，导致「今天上午说的」搜不到）
 *   2) 命中门限可配（highGate / midGate）
 *   3) 参数接受 camelCase 与 snake_case 两种写法
 *
 * 跑法：node tools/verify-0.2.3.mjs
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

const { rankQuery } = await import(url('lib', 'search.mjs'))

const now = Date.now()
const mk = (session, t, text) => ({ session, t, role: 'user', text, ws: 'w', wsPretty: 'w' })
const chunks = [
  mk('session-active', now - 5 * 60000, '今天上午那个 BOM 的坑，最后是缓存没清。'), // 活跃会话，余弦 0.66
  mk('session-old', now - 5 * 86400000, '上周讨论过蓝色小猫的配色方案。'), // 旧会话，余弦 0.50
]
const dim = 2
const vec = (a) => [a, Math.sqrt(1 - a * a)]
const vecs = new Float32Array([...vec(0.66), ...vec(0.50)])
const loaded = {
  meta: { chunks, builtAt: new Date(now - 3600000).toISOString(), provider: 'cloud' },
  vecs, dim, count: chunks.length,
}
const queryVec = [1, 0]
const base = { query: '当时那样处理是否妥当', loaded, queryVec, days: 30, role: undefined }

// 1. 默认包含活跃会话
const withActive = rankQuery({ ...base, includeActive: true, nowMs: now })
ok(withActive.grouped.some((g) => g.session === 'session-active'), 'includeActive=true 时活跃会话可见')
const without = rankQuery({ ...base, includeActive: false, nowMs: now })
ok(!without.grouped.some((g) => g.session === 'session-active'), 'includeActive=false 时活跃会话被排除')

// 2. 门限可配：0.66 在默认线下判否、放宽后判是
const strict = rankQuery({ ...base, includeActive: true, highGate: 0.70, midGate: 0.55, nowMs: now })
ok(strict.found === false, '默认门限下 0.66 且无字面证据 → 不确认', `top=${strict.topScore.toFixed(3)}`)
const loose = rankQuery({ ...base, includeActive: true, highGate: 0.65, midGate: 0.55, nowMs: now })
ok(loose.found === true, '把高分线放宽到 0.65 → 确认命中', `top=${loose.topScore.toFixed(3)}`)

// 3. 参数别名：camelCase / snake_case 都要能进（读 index.js 源码里的取值方式）
const src = await (await import('node:fs/promises')).readFile(join(root, 'index.js'), 'utf8')
ok(/args\?\.maxSessions \?\? args\?\.max_sessions/.test(src), 'maxSessions / max_sessions 双写法')
ok(/args\?\.includeActive \?\? args\?\.include_active/.test(src), 'includeActive / include_active 双写法')
ok(/includeActiveArg === undefined \? true/.test(src), 'includeActive 缺省 = true')
ok(/minScore/.test(src) && /midScore/.test(src), '门限可从配置读（minScore / midScore）')

console.log(fail ? `\n❌ ${fail} 项未通过` : '\n✅ 全部通过')
process.exit(fail ? 1 : 0)
