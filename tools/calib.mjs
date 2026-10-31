/**
 * tools/calib.mjs —— 字面模式的阈值标定：**用 BM25 真正索引的 bigram** 来量，别拿单字自欺
 */
import { loadIndex } from '../lib/vectorstore.mjs'
import { BM25, tokenize } from '../lib/search.mjs'

const loaded = await loadIndex()
if (!loaded) { console.log('没有索引'); process.exit(1) }
const chunks = loaded.meta.chunks
const bm = new BM25(chunks.map((c) => c.text))

const STOP = new Set('你您的了是在和就都也还很呢吧啊呀吗么个这那他她它们请把给对从到有没不要会能想让我'.split(''))
const TIME = ['前几天', '这几天', '这两天', '这些天', '最近', '近期', '上周', '上个星期', '上星期', '昨天', '今天', '前天']
const FILLER = ['你还记得', '你记得', '还记得', '这么个事', '这个事', '那件事', '那事', '这件事']

function clean(q) {
  let s = q
  for (const w of TIME.concat(FILLER)) s = s.split(w).join('')
  return s.replace(/\d+\s*[号日天前]/g, '')
}

function contentBigrams(q) {
  const core = clean(q)
  const out = []
  for (let i = 0; i < core.length - 1; i++) {
    const b = core.slice(i, i + 2)
    if (STOP.has(b[0]) || STOP.has(b[1])) continue
    if ((bm.df.get(b) || 0) > Math.max(3, bm.N * 0.05)) continue
    out.push(b)
  }
  return [...new Set(out)]
}

const queries = [
  '注入攻击', '你还记得我前几天说去哪吃饭这么个事吗', 'E 盘说红的软件', '表情包',
  '那个软件', '昨天说的那个事', '你知道那个东西吗', '泽菲拉的画风训练',
]

for (const q of queries) {
  const bs = contentBigrams(q)
  const lex = bm.scores(tokenize(clean(q)))
  const order = [...lex.keys()].sort((a, b) => lex[b] - lex[a])
  const rows = order.slice(0, 3).map((i) => {
    const text = chunks[i].text
    const hit = bs.filter((b) => text.includes(b))
    return { i, score: lex[i], cov: bs.length ? hit.length / bs.length : 0, hit, text: text.slice(0, 50).replace(/\n/g, ' ') }
  })
  const dfList = bs.map((b) => `${b}(${bm.df.get(b) || 0})`).join(' ')
  console.log(`\n「${q}」 bigrams: ${dfList || '(无)'}`)
  for (const r of rows) {
    console.log(`  ${r.score.toFixed(2)} cov=${r.cov.toFixed(2)} hit=${r.hit.join(',') || '-'} | ${r.text}`)
  }
}
