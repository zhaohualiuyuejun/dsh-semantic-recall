/**
 * lib/search.mjs —— 混合检索（向量余弦 + BM25，RRF 融合）
 *
 * 继承旁路 MVP 的四条已验证结论：
 *   ① 时间锚点：今天/昨天/前天/上周/N 天前/N 号/前几天 → 自动圈时间窗
 *   ② 会话级聚合：返回「那场对话」，而不是孤零零一句
 *   ③ 低分回退：最高余弦 < 0.55 ⇒ 不装懂，改给候选菜单（宁可给候选，不硬答）
 *   ④ 中文双字跨词边界不可靠 ⇒ 不拿 bigram 当「必须命中」判据，只用单一余弦阈值
 */
import { cosine } from './embed.mjs'
import { vectorAt } from './vectorstore.mjs'

export const RRF_K = 60
export const GATE = 0.55
/** 高分线：过了这条线就不必再看字面证据（实测真命中 ≥0.70，假命中最高 0.616） */
export const HIGH_GATE = 0.70

// ---------------------------------------------------------------- ① 时间锚点
export function parseTimeCue(q, today = new Date()) {
  const T = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = (n) => { const x = new Date(T); x.setDate(x.getDate() + n); return x }
  const s = String(q || '')
  if (s.includes('今天') || s.includes('刚才')) return { start: T, end: T, label: '今天' }
  if (s.includes('昨天')) return { start: d(-1), end: d(-1), label: '昨天' }
  if (s.includes('前天')) return { start: d(-2), end: d(-2), label: '前天' }
  if (/上周|上个星期|上星期/.test(s)) {
    const iso = (T.getDay() + 6) % 7 // 周一=0
    const monday = d(-iso)
    return { start: d(-iso - 7), end: new Date(monday.getTime() - 86400000), label: '上周' }
  }
  if (/本周|这周|这个星期/.test(s)) {
    const iso = (T.getDay() + 6) % 7
    return { start: d(-iso), end: T, label: '本周' }
  }
  let m = /(\d+)\s*天前/.exec(s)
  if (m) { const x = d(-Number(m[1])); return { start: x, end: x, label: `${m[1]} 天前` } }
  m = /(\d{1,2})\s*[号日]/.exec(s)
  if (m) {
    const day = Number(m[1])
    let x = new Date(T.getFullYear(), T.getMonth(), day)
    if (x > T) x = new Date(T.getFullYear(), T.getMonth() - 1, day)
    if (!Number.isNaN(x.getTime())) return { start: x, end: x, label: `${day} 号` }
    return null
  }
  if (/前几天|这几天|这两天|最近|近期|这些天/.test(s)) {
    return { start: d(-6), end: T, label: '最近 7 天' }
  }
  return null
}

function dayKeyOf(t) {
  const x = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// ---------------------------------------------------------------- ② 字面路（BM25）
const STOP_CHARS = new Set('你您的了是在和就都也还很呢吧啊呀吗么个这那他她它们请把给对从到有没不要会能想让我'.split(''))
const TIME_WORDS = ['前几天', '这几天', '这两天', '这些天', '最近', '近期', '上周', '上个星期', '上星期', '昨天', '今天', '前天']
const FILLER_WORDS = ['你还记得', '你记得', '还记得', '这么个事', '这个事', '那件事', '那事', '这件事']

export function tokenize(text) {
  const out = []
  const s = String(text || '').toLowerCase()
  for (const w of s.match(/[a-z0-9_]{2,}/g) || []) out.push(w)
  for (const seg of s.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2))
  }
  return out
}

export class BM25 {
  constructor(docs, k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    this.docs = docs.map((d) => {
      const c = new Map()
      for (const t of tokenize(d)) c.set(t, (c.get(t) || 0) + 1)
      return c
    })
    this.lens = this.docs.map((c) => { let n = 0; for (const v of c.values()) n += v; return n })
    this.avg = this.lens.reduce((a, b2) => a + b2, 0) / Math.max(this.lens.length, 1) || 1
    this.df = new Map()
    for (const c of this.docs) for (const w of c.keys()) this.df.set(w, (this.df.get(w) || 0) + 1)
    this.N = this.docs.length
  }

  scores(tokens) {
    const q = new Map()
    for (const t of tokens) q.set(t, (q.get(t) || 0) + 1)
    const out = new Float64Array(this.N)
    for (let i = 0; i < this.N; i++) {
      const c = this.docs[i]
      let s = 0
      for (const [w, qf] of q) {
        const tf = c.get(w) || 0
        if (!tf) continue
        const df = this.df.get(w) || 0
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5))
        s += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * this.lens[i] / this.avg))
      }
      out[i] = s
    }
    return out
  }
}

function stripFiller(q) {
  let s = String(q || '')
  for (const w of TIME_WORDS.concat(FILLER_WORDS)) s = s.split(w).join('')
  return s.replace(/\d+\s*[号日天前]/g, '').trim()
}

/** 有效查询词：英文词 + 实词 bigram（高频词当噪声丢掉） */
function queryTokens(q, bm) {
  const out = (String(q).toLowerCase().match(/[a-z0-9_]{2,}/g) || []).slice()
  const core = stripFiller(q)
  const n = bm.N
  const all = []
  for (let i = 0; i < core.length - 1; i++) {
    const b = core.slice(i, i + 2)
    if (b.length !== 2) continue
    if (STOP_CHARS.has(b[0]) || STOP_CHARS.has(b[1])) continue
    all.push(b)
    if ((bm.df.get(b) || 0) > Math.max(3, n * 0.05)) continue
    out.push(b)
  }
  // 全是很常见的词（比如「表情包」）时不要把查询清空：宁可噪声大一点，也要给出候选
  if (!out.length && all.length) out.push(...new Set(all))
  return out
}

/** 查询里的**稀有实词 bigram**（df ≤ 5）：纯字面模式下，只有它真的出现才敢说「找到了」
 *  ⚠️ 不用「覆盖率」当判据：1200 字的块很容易把整句问题都包进去（实测踩过——讨论检索本身的那段
 *     把「去哪吃饭」原话都包含了，覆盖率 1.00），所以覆盖率会骗人。 */
function rareTokens(q, bm, limit = 6) {
  const core = stripFiller(q)
  const out = []
  for (let i = 0; i < core.length - 1; i++) {
    const b = core.slice(i, i + 2)
    if (STOP_CHARS.has(b[0]) || STOP_CHARS.has(b[1])) continue
    const df = bm.df.get(b) || 0
    if (df > 0 && df <= 5 && !out.includes(b)) out.push(b)
  }
  return out.slice(0, limit)
}

// ---------------------------------------------------------------- ③ 会话聚合
const SYS_STARTS = ['Current time', 'Current runtime context', 'Time sampled', '本次执行由任务看板',
  '标签提示（任务看板', '<system-reminder>', 'You are the Team Lead', 'A browser bridge may be connected',
  '<available_skills>', 'You are repeating', 'background job', 'The user chose']

export function activeSessions(chunks, minutes = 30, nowMs = Date.now()) {
  const latest = new Map()
  for (const c of chunks) {
    const cur = latest.get(c.session) || 0
    if (c.t > cur) latest.set(c.session, c.t)
  }
  const out = new Set()
  for (const [sid, t] of latest) if (nowMs - t <= minutes * 60000) out.add(sid)
  return out
}

export function recentMenu(chunks, { days = 7, limit = 8, nowMs = Date.now() } = {}) {
  const cutoff = startOfDay(new Date(nowMs)) - (days - 1) * 86400000
  const bySession = new Map()
  for (const c of chunks) {
    if (c.t < cutoff) continue
    if (!bySession.has(c.session)) bySession.set(c.session, [])
    bySession.get(c.session).push(c)
  }
  const rows = []
  for (const [sid, items] of bySession) {
    items.sort((a, b) => a.t - b.t)
    const users = items.filter((c) => c.role === 'user' && !SYS_STARTS.some((p) => c.text.trimStart().startsWith(p)))
    if (!users.length) continue
    rows.push({
      session: sid,
      workspace: items[0].wsPretty || items[0].ws,
      last: items[items.length - 1].t,
      first: items[0].t,
      count: items.length,
      preview: users[0].text.slice(0, 60).replace(/\s+/g, ' '),
    })
  }
  rows.sort((a, b) => b.last - a.last)
  return rows.slice(0, limit)
}

// ---------------------------------------------------------------- 融合与检索
function rrf(orders, k = RRF_K) {
  const fused = new Map()
  for (const list of orders) {
    for (let r = 0; r < list.length; r++) {
      const i = list[r]
      fused.set(i, (fused.get(i) || 0) + 1 / (k + r + 1))
    }
  }
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i)
}

const bmCache = new Map() // builtAt → { bm, chunks }

function getBM25(meta) {
  const key = `${meta.builtAt}|${meta.chunks.length}`
  const hit = bmCache.get(key)
  if (hit) return hit
  const bm = new BM25(meta.chunks.map((c) => c.text))
  if (bmCache.size > 3) bmCache.clear()
  const entry = { bm, chunks: meta.chunks }
  bmCache.set(key, entry)
  return entry
}

/**
 * 字面证据：top 块里有没有出现查询的**稀有词**（英文词 ≥2 字母 / 中文 bigram 且 df ≤ 10）
 * ⚠️ 实测（2026-10-31，2561 块 / 15 条标定查询）：单看余弦分、看 gap、看 z 分数**都分不开**
 *    真命中与「AI 在讨论这句话本身」/「纯模糊问句」。只有「语义分 + 词面覆盖」双条件能把假阳性压到 0。
 *    ➜ 代价是少数「换个说法问」会被判成未命中（给候选）——这符合「宁可给候选，不装懂」。
 */
function lexicalEvidence(query, chunks, idxs, bm) {
  const core = stripFiller(query)
  const en = (String(query).toLowerCase().match(/[a-z0-9_]{2,}/g) || [])
  const bigs = []
  const total = new Set()
  for (let i = 0; i < core.length - 1; i++) {
    const b = core.slice(i, i + 2)
    if (STOP_CHARS.has(b[0]) || STOP_CHARS.has(b[1])) continue
    total.add(b)
    const df = bm.df.get(b) || 0
    if (df > 0 && df <= 5) bigs.push(b)
  }
  const found = []
  let bigramHits = 0
  for (const i of idxs) {
    const t = String(chunks[i].text || '').toLowerCase()
    for (const w of en) if (t.includes(w)) found.push(w)
    for (const b of bigs) if (t.includes(b)) { found.push(b); bigramHits++ }
  }
  const uniq = [...new Set(found)]
  const coverage = total.size ? uniq.filter((x) => x.length === 2 && total.has(x)).length / total.size : 0
  return {
    matched: uniq,
    coverage: Number(coverage.toFixed(2)),
    hasEnglish: en.some((w) => uniq.includes(w)),
  }
}

function trimStopChars(s) {
  let a = s
  while (a.length && STOP_CHARS.has(a[0])) a = a.slice(1)
  while (a.length && STOP_CHARS.has(a[a.length - 1])) a = a.slice(0, -1)
  return a
}

/**
 * 自我引用闸门：top 块是 **AI** 说的话，而且把问题的核心串**原样复述**了一遍
 * ⇒ 它在「讨论这句话」而不是「回答这句话」（实测：MVP 调试那场对话把测试问句原样写进了语料，
 *    于是「去哪吃饭」拿到 0.576，高于闸门 —— 这是最伤信任的假阳性）。
 */
function isSelfReference(query, chunks, topIdx) {
  const c = chunks[topIdx]
  if (!c || c.role !== 'assistant') return false
  const core = trimStopChars(stripFiller(query).replace(/\s+/g, '').toLowerCase())
  if (core.length < 4) return false
  return String(c.text || '').replace(/\s+/g, '').toLowerCase().includes(core)
}

/**
 * 核心检索。
 * @returns {{ found, topScore, cue, grouped, lexOnly, activeCount, lexicalTop, evidence, selfRef, confidence }}
 */
export function rankQuery({ query, loaded, queryVec, days, role, includeActive, excludeSession, highGate = HIGH_GATE, midGate = GATE, nowMs = Date.now() }) {
  const meta = loaded.meta
  const chunks = meta.chunks
  const n = chunks.length

  const { bm } = getBM25(meta)
  const qt = queryTokens(query, bm)
  const lex = qt.length ? bm.scores(qt) : new Float64Array(n)

  // 时间窗（天）+ 角色过滤
  const cutoff = startOfDay(new Date(nowMs)) - (Math.max(1, days) - 1) * 86400000
  const allowed = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const c = chunks[i]
    if (c.t < cutoff) continue
    if (role && c.role !== role) continue
    allowed[i] = 1
  }

  const active = activeSessions(chunks, 30, nowMs)

  // 向量路
  let cos = null
  if (queryVec && loaded.dim) {
    cos = new Float32Array(n)
    for (let i = 0; i < n; i++) cos[i] = allowed[i] ? cosine(queryVec, vectorAt(loaded, i)) : -1
  }

  // 融合：有向量就 RRF（向量 + 字面），没有就纯字面
  let order
  if (cos) {
    const vecOrder = [...Array(n).keys()].filter((i) => allowed[i]).sort((a, b) => cos[b] - cos[a])
    const lexOrder = [...Array(n).keys()].filter((i) => allowed[i] && lex[i] > 0).sort((a, b) => lex[b] - lex[a])
    const fused = rrf(lexOrder.length ? [vecOrder, lexOrder] : [vecOrder])
    // 当前活跃会话降权（不剔除，避免「今天刚聊的」搜不到）
    order = fused
      .map((i, r) => ({ i, v: r * (active.has(chunks[i].session) ? 2.5 : 1) }))
      .sort((a, b) => a.v - b.v)
      .map((x) => x.i)
  } else {
    order = [...Array(n).keys()].filter((i) => allowed[i] && lex[i] > 0).sort((a, b) => lex[b] - lex[a])
  }

  // 时间锚点
  const cue = parseTimeCue(query)
  let filtered = order
  if (cue) {
    const s = cue.start.getTime()
    const e = startOfDay(cue.end) + 86399999
    filtered = order.filter((i) => chunks[i].t >= s && chunks[i].t <= e)
  }
  // 排除的是「调用方自己这场」——当前对话本来就在上下文里，没必要再搜回来。
  // 只有拿不到调用方 id 时才退回旧行为（整批排除 30 分钟内活跃的会话）。
  if (excludeSession) filtered = filtered.filter((i) => chunks[i].session !== excludeSession)
  else if (!includeActive) filtered = filtered.filter((i) => !active.has(chunks[i].session))

  // 低分判据（双条件 + 自我引用闸门）
  let topScore = 0
  let lexicalTop = 0
  for (const i of filtered.slice(0, 50)) {
    if (cos && cos[i] > topScore) topScore = cos[i]
    if (lex[i] > lexicalTop) lexicalTop = lex[i]
  }
  const topIdxs = filtered.slice(0, 3)
  const ev = lexicalEvidence(query, chunks, topIdxs, bm)
  const evidence = ev.matched
  const evidenceOk = ev.hasEnglish || ev.coverage >= 0.5
  const selfRef = topIdxs.length ? isSelfReference(query, chunks, topIdxs[0]) : false

  let found = false
  let confidence = 'none'
  if (cos) {
    if (topScore >= highGate) {
      found = !selfRef
      confidence = found ? 'high' : 'weak'
    } else if (topScore >= midGate && evidenceOk) {
      found = !selfRef
      confidence = found ? 'medium' : 'weak'
    }
  } else {
    const rare = rareTokens(query, bm)
    found = topIdxs.some((i) => rare.some((w) => chunks[i].text.includes(w)))
    confidence = found ? 'medium' : 'none'
  }

  // 会话聚合
  const bySession = new Map()
  for (const i of filtered) {
    const sid = chunks[i].session
    const row = bySession.get(sid)
    if (row) row.items.push(i)
    else bySession.set(sid, { session: sid, ws: chunks[i].ws, wsPretty: chunks[i].wsPretty, items: [i] })
  }
  const grouped = [...bySession.values()]
    .map((g) => {
      g.items.sort((a, b) => (cos ? cos[b] - cos[a] : lex[b] - lex[a]))
      const scores = g.items.map((i) => (cos ? cos[i] : lex[i]))
      return { ...g, score: Math.max(...scores), lexScore: Math.max(...g.items.map((i) => lex[i])) }
    })
    .sort((a, b) => b.score - a.score)

  return { found, topScore, cue, grouped, lexOnly: !cos, activeCount: active.size, lexicalTop, evidence, evidenceCoverage: ev.coverage, selfRef, confidence }
}

export { dayKeyOf, startOfDay }
