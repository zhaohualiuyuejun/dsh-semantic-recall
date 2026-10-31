/**
 * verify-qq-extract.mjs —— 验收：桥接通道（QQ）真实对话能否被抽取
 * 只读真实会话；只打印统计与极短前缀。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { extractSessions } from '../lib/extract.mjs'
import { buildChunks } from '../lib/chunk.mjs'

const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
const WS = '--H-deepseek-fanfan-dsh-qq-state-agents--'

let ok = 0, bad = 0
const t = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('OK   ' + name) }
  else { bad++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) }
}

const { recs } = await extractSessions({ root, days: 30, wsFilter: (w) => w === WS })
const user = recs.filter((r) => r.role === 'user')
const asst = recs.filter((r) => r.role === 'assistant')
const fromTool = recs.filter((r) => r.fromTool)
const noisy = user.filter((r) => r.text.startsWith('【当前时间】') || r.text.startsWith('【当前角色】'))

console.log('总记录', recs.length, '| user', user.length, '| assistant', asst.length, '| 来自工具', fromTool.length)
console.log('残留人设注入（user）', noisy.length)
console.log(`来自工具的比例 ${(fromTool.length / Math.max(1, recs.length) * 100).toFixed(1)}%`)

t('抽到了记录', recs.length > 0)
t('从工具里抽到了真实对话（发送或接收）', fromTool.length > 0, String(fromTool.length))
t('真人 user 消息不再被人设注入淹没', user.length > 0 && noisy.length / Math.max(1, user.length) < 0.2,
  `残留 ${noisy.length}/${user.length}`)
t('assistant 里有从「发送工具」提取的回复', asst.some((r) => r.fromTool))
t('工具提取的记录带时间', fromTool.every((r) => Number.isFinite(r.t) && r.t > 0))
t('工具提取的记录带 messageId 或 seq', fromTool.every((r) => r.msgId || r.seq !== null))

const chunks = buildChunks(recs)
console.log('切块后块数', chunks.length)
t('切块后能建出索引内容', chunks.length > 500, String(chunks.length))

console.log('\n--- 样本（前 50 字）---')
for (const r of recs.slice(0, 8)) {
  console.log(`[${r.role}]${r.fromTool ? '(工具)' : ''} t=${new Date(r.t).toISOString().slice(5, 16)} | ${r.text.replace(/\s+/g, ' ').slice(0, 50)}`)
}

console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
