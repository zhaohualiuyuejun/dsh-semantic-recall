/**
 * verify-anchors.mjs —— 验收：返回锚点（sessionId / messageId / seq）
 * 只读真实会话文件，不写任何东西。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { extractSessions } from '../lib/extract.mjs'
import { buildChunks } from '../lib/chunk.mjs'

const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
let ok = 0, bad = 0
const t = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('OK   ' + name) }
  else { bad++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) }
}

const { recs } = await extractSessions({ root, days: 30, wsFilter: (w) => w === '--H-deepseek-zefeila--' })
t('抽到了记录', recs.length > 0, String(recs.length))

const withId = recs.filter((r) => r.msgId)
const withSeq = recs.filter((r) => r.seq !== null && r.seq !== undefined)
t('记录带 messageId', withId.length > 0, `${withId.length}/${recs.length}`)
t('记录带 seq', withSeq.length > 0, `${withSeq.length}/${recs.length}`)
t('记录带 sessionId（非空字符串）', recs.every((r) => typeof r.session === 'string' && r.session.length > 0))
const stdSid = recs.filter((r) => r.session.startsWith('session-')).length
console.log(`     session 以 session- 开头的比例：${stdSid}/${recs.length}`)

const chunks = buildChunks(recs)
const cWithId = chunks.filter((c) => c.msgId)
t('块带 messageId', cWithId.length > 0, `${cWithId.length}/${chunks.length}`)
t('块带 seq', chunks.some((c) => c.seq !== null && c.seq !== undefined))
t('块带 sessionId', chunks.every((c) => c.session))

const sample = withId[0]
console.log('\n样本（一条消息）:')
console.log('  session =', sample.session)
console.log('  msgId   =', sample.msgId)
console.log('  seq     =', sample.seq)
console.log('  role    =', sample.role)
console.log('  text    =', String(sample.text).slice(0, 80).replace(/\n/g, ' '))

console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
