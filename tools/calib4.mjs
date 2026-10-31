/**
 * tools/calib4.mjs —— 量「突出度」：top1 相对 top20 的均值/标准差有多突出（z 分数）
 */
import { readFileSync } from 'node:fs'
import { loadIndex } from '../lib/vectorstore.mjs'
import { embedQuery } from '../lib/embed.mjs'
import { rankQuery } from '../lib/search.mjs'
import { configPath } from '../lib/localcfg.mjs'

const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
const loaded = await loadIndex()

const Q = [
  ['Shotcut 剪辑软件', 'hit'], ['V4 人物终版定档', 'hit'], ['表情包底图像素太高会怎样', 'hit'],
  ['记忆和人格的区别是什么', 'hit'], ['C盘满了怎么清理', 'hit'], ['Qwen 图像编辑要不要挂人设 LoRA', 'hit'],
  ['饭饭三端记忆共享', 'hit'], ['训练数据集要多少张图', 'hit'],
  ['你还记得我前几天说去哪吃饭这么个事吗', 'miss'], ['昨天说的那个事', 'miss'],
  ['我家的猫叫什么名字', 'miss'], ['明天天气怎么样', 'miss'], ['那个软件', 'miss'], ['上次那个考试分数', 'miss'],
  ['帮我写一首诗', 'miss'],
]

console.log('query | top1 | mean20 | sd | z | 期望')
for (const [q, want] of Q) {
  const v = (await embedQuery(q, { ...loaded.meta, apiKey: cfg.apiKey, provider: 'siliconflow', model: '' }))[0]
  const r = rankQuery({ query: q, loaded, queryVec: v, days: 7 })
  const scores = r.grouped.map((g) => g.score).slice(0, 20)
  const top1 = scores[0] ?? 0
  const rest = scores.slice(1)
  const mean = rest.reduce((a, b) => a + b, 0) / Math.max(rest.length, 1)
  const sd = Math.sqrt(rest.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rest.length, 1))
  const z = sd ? (top1 - mean) / sd : 0
  console.log(`${q} | ${top1.toFixed(3)} | ${mean.toFixed(3)} | ${sd.toFixed(3)} | ${z.toFixed(2)} | ${want}`)
}
