/**
 * tools/calib2.mjs —— 语义模式的闸门标定：看 top1 / top2 / 差距，别拍脑袋定阈值
 * 用法：node tools/calib2.mjs
 * （从 config.json 读 Key，脚本里不回显）
 */
import { readFileSync } from 'node:fs'
import { loadIndex } from '../lib/vectorstore.mjs'
import { embedQuery } from '../lib/embed.mjs'
import { rankQuery } from '../lib/search.mjs'
import { configPath } from '../lib/localcfg.mjs'

const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
const loaded = await loadIndex()
if (!loaded) { console.log('没有索引'); process.exit(1) }

const QUERIES = [
  // 期望命中
  ['Shotcut 剪辑软件', 'hit'],
  ['V4 人物终版定档', 'hit'],
  ['表情包底图像素太高会怎样', 'hit'],
  ['记忆和人格的区别是什么', 'hit'],
  ['C盘满了怎么清理', 'hit'],
  ['Qwen 图像编辑要不要挂人设 LoRA', 'hit'],
  ['饭饭三端记忆共享', 'hit'],
  // 期望回退（库里没有 / 太模糊）
  ['你还记得我前几天说去哪吃饭这么个事吗', 'miss'],
  ['昨天说的那个事', 'miss'],
  ['我家的猫叫什么名字', 'miss'],
  ['明天天气怎么样', 'miss'],
  ['那个软件', 'miss'],
  ['上次那个考试分数', 'miss'],
]

console.log('query | top1 | gap | found | conf | 证据 | 期望')
for (const [q, want] of QUERIES) {
  const v = (await embedQuery(q, { ...loaded.meta, apiKey: cfg.apiKey, provider: 'siliconflow', model: '' }))[0]
  const r = rankQuery({ query: q, loaded, queryVec: v, days: 7 })
  const sc = r.grouped.map((g) => Number(g.score.toFixed(3)))
  const top1 = sc[0] ?? 0
  const top2 = sc[1] ?? 0
  const mark = (r.found ? 'HIT ' : 'miss') === (want === 'hit' ? 'HIT ' : 'miss') ? '✅' : '❌'
  console.log(`${mark} ${q} | ${top1.toFixed(3)} | ${(top1 - top2).toFixed(3)} | ${r.found} | ${r.confidence}${r.selfRef ? '/self' : ''} | ${r.evidence.slice(0, 3).join(',') || '-'} | ${want}`)
}
