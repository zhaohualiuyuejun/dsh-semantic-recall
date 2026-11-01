/**
 * tools/verify-0.2.4.mjs —— 验证 0.2.4 的排除语义（不联网、不碰真实会话）
 *
 *   1) 默认只排除「调用方自己这场会话」，其他最近活跃的会话照常可搜
 *   2) 拿不到调用方 id 时，退回旧行为（整批排除活跃会话）
 *   3) includeActive=true 时连自己这场也一起搜
 *
 * 跑法：node tools/verify-0.2.4.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

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
  mk('session-caller', now - 3 * 60000, '当前这场对话里的内容。'), // 调用方自己
  mk('session-other', now - 8 * 60000, '上一场刚归档的对话，聊的是缓存没清。'), // 别的活跃会话
  mk('session-old', now - 5 * 86400000, '上周讨论过配色方案。'), // 旧会话
]
const dim = 2
const vec = (a) => [a, Math.sqrt(1 - a * a)]
const vecs = new Float32Array([...vec(0.70), ...vec(0.66), ...vec(0.50)])
const loaded = {
  meta: { chunks, builtAt: new Date(now - 3600000).toISOString(), provider: 'cloud' },
  vecs, dim, count: chunks.length,
}
const queryVec = [1, 0]
const base = { query: '当时那样处理是否妥当', loaded, queryVec, days: 30, role: undefined, nowMs: now }

// 1. 默认语义：只排除调用方自己
const precise = rankQuery({ ...base, includeActive: false, excludeSession: 'session-caller' })
const pSessions = precise.grouped.map((g) => g.session)
ok(!pSessions.includes('session-caller'), '排除调用方自己这场')
ok(pSessions.includes('session-other'), '其他活跃会话照常可搜（弟弟流程的关键）')

// 2. 拿不到调用方 id → 退回旧行为
const legacy = rankQuery({ ...base, includeActive: false })
const lSessions = legacy.grouped.map((g) => g.session)
ok(!lSessions.includes('session-other') && !lSessions.includes('session-caller'), '无 id 时退回「整批排除活跃会话」')

// 3. 显式 includeActive=true → 自己这场也能搜
const inclusive = rankQuery({ ...base, includeActive: true })
ok(inclusive.grouped.some((g) => g.session === 'session-caller'), 'includeActive=true 时自己这场可搜')

// 4. index.js 接线：从 exec.agent.session.id 取调用方 id，并把它传下去
const src = await readFile(join(root, 'index.js'), 'utf8')
ok(/exec\?\.agent\?\.session\?\.id/.test(src), '调用方 id 从 exec.agent.session.id 取')
ok(/excludeSession: includeActive \? '' : callerSession/.test(src), 'includeActive=false 时传 excludeSession')
ok(/const includeActive = includeActiveArg === true/.test(src), 'includeActive 缺省 = false（维持原设计）')

console.log(fail ? `\n❌ ${fail} 项未通过` : '\n✅ 全部通过')
process.exit(fail ? 1 : 0)
