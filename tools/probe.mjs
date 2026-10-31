/**
 * tools/probe.mjs —— 最小实验：确认本机 DSH 的 session.v4.jsonl.zstd 能解开、能抽到人话
 * 用法：node tools/probe.mjs [天数] [工作区子串]
 */
import { extractSessions } from '../lib/extract.mjs'
import { sessionsRoot } from '../lib/paths.mjs'

const days = Number(process.argv[2] || 1)
const filter = process.argv[3] || ''
const root = sessionsRoot()

const t0 = Date.now()
const { recs, fileCount } = await extractSessions({
  root,
  days,
  wsFilter: (ws) => !filter || ws.includes(filter),
  onProgress: () => {},
})

const users = recs.filter((r) => r.role === 'user')
const asst = recs.filter((r) => r.role === 'assistant')
const sessions = new Set(recs.map((r) => r.session))
console.log(JSON.stringify({
  root,
  days,
  fileCount,
  sessions: sessions.size,
  user: users.length,
  assistant: asst.length,
  chars: recs.reduce((s, r) => s + r.text.length, 0),
  ms: Date.now() - t0,
}, null, 2))

for (const r of users.slice(0, 3)) {
  console.log('---', new Date(r.t).toISOString(), r.wsPretty, r.session.slice(0, 8))
  console.log(r.text.slice(0, 120).replace(/\n/g, ' '))
}
