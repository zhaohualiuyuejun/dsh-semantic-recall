/**
 * tools/calib3.mjs —— 量「字面证据」：top 块里出现了查询的哪些 bigram，各自多稀有
 */
import { readFileSync } from 'node:fs'
import { loadIndex } from '../lib/vectorstore.mjs'
import { embedQuery } from '../lib/embed.mjs'
import { rankQuery, BM25, tokenize } from '../lib/search.mjs'
import { configPath } from '../lib/localcfg.mjs'

const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
const loaded = await loadIndex()
const chunks = loaded.meta.chunks
const bm = new BM25(chunks.map((c) => c.text))

const STOP = new Set('你您的了是在和就都也还很呢吧啊呀吗么个这那他她它们请把给对从到有没不要会能想让我'.split(''))
const TIME = ['前几天', '这几天', '这两天', '这些天', '最近', '近期', '上周', '上个星期', '上星期', '昨天', '今天', '前天']
const FILLER = ['你还记得', '你记得', '还记得', '这么个事', '这个事', '那件事', '那事', '这件事']

function bigrams(q) {
  let s = q
  for (const w of TIME.concat(FILLER)) s = s.split(w).join('')
  s = s.replace(/\d+\s*[号日天前]/g, '')
  const out = []
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2)
    if (STOP.has(b[0]) || STOP.has(b[1])) continue
    out.push(b)
  }
  return [...new Set(out)]
}

const QUERIES = [
  ['Shotcut 剪辑软件', 'hit'], ['V4 人物终版定档', 'hit'], ['表情包底图像素太高会怎样', 'hit'],
  ['记忆和人格的区别是什么', 'hit'], ['C盘满了怎么清理', 'hit'], ['Qwen 图像编辑要不要挂人设 LoRA', 'hit'],
  ['饭饭三端记忆共享', 'hit'],
  ['你还记得我前几天说去哪吃饭这么个事吗', 'miss'], ['昨天说的那个事', 'miss'],
  ['我家的猫叫什么名字', 'miss'], ['明天天气怎么样', 'miss'], ['那个软件', 'miss'], ['上次那个考试分数', 'miss'],
]

console.log('query | top1 | 命中bigram(df) | 最小df | 期望')
for (const [q, want] of QUERIES) {
  const v = (await embedQuery(q, { ...loaded.meta, apiKey: cfg.apiKey, provider: 'siliconflow', model: '' }))[0]
  const r = rankQuery({ query: q, loaded, queryVec: v, days: 7 })
  const top = r.grouped[0]
  const idx = top.items[0]
  const text = chunks[idx].text
  const bs = bigrams(q)
  const hit = bs.filter((b) => text.includes(b)).map((b) => `${b}(${bm.df.get(b) || 0})`)
  const dfs = bs.filter((b) => text.includes(b) && (bm.df.get(b) || 0) > 0).map((b) => bm.df.get(b))
  const minDf = dfs.length ? Math.min(...dfs) : 9999
  console.log(`${q} | ${top.score.toFixed(3)} | ${hit.join(' ') || '-'} | ${minDf === 9999 ? '-' : minDf} | ${want}`)
}
