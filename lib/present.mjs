/**
 * lib/present.mjs —— 返回层的「展示加工」（0.3.0）
 * ============================================================================
 * 只做纯函数，不碰索引、不碰向量、不产生新知识：
 *   ① dateFields：给每条结果就地算日期（dateText / dateHuman / ageDays / isRecent）
 *   ② fingerprint + dedupeSessionHits：近重复抑制（跨会话合并，不丢原始字段）
 *   ③ applyFreshFirst：可选的新块优先排序
 *
 * 边界（见 docs/插件优化方向-dsh-semantic-recall.md「三、边界标准」）：
 *   只标注、只合并展示、只排序 = 检索层；这里不判断「谁取代谁」，也不做语义聚类。
 * ============================================================================
 */

const DAY = 86400000

/** 本地时区的当天 0 点（毫秒） */
export function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * 给一个时间戳就地算日期字段。
 * @param {number|string|Date} t
 * @param {number} nowMs
 * @returns {{ dateText: string, dateHuman: string, ageDays: number, isRecent: boolean }}
 *   dateText  = 本地时区 YYYY-MM-DD（引用时必须带）
 *   dateHuman = M月D日 HH:mm
 *   ageDays   = 按日历天算距今天数
 *   isRecent  = 距今 <= 7 天
 */
export function dateFields(t, nowMs = Date.now()) {
  const d = new Date(t instanceof Date ? t.getTime() : Number(t))
  if (!Number.isFinite(d.getTime())) {
    return { dateText: '', dateHuman: '', ageDays: null, isRecent: false }
  }
  const p2 = (x) => String(x).padStart(2, '0')
  const dateText = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const dateHuman = `${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}`
  const ageDays = Math.max(0, Math.round((startOfDayLocal(new Date(nowMs)) - startOfDayLocal(d)) / DAY))
  const isRecent = nowMs - d.getTime() <= 7 * DAY
  return { dateText, dateHuman, ageDays, isRecent }
}

/** FNV-1a 32 位（只用于内容指纹，不做安全用途） */
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * 内容指纹：空白归一化 + 前 120 字 + role 区分。
 * 加 role 是为了不把「用户原话」和「AI 复述同一句」误合并——那是两条不同信息。
 */
export function fingerprint(text, role = '') {
  const norm = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase()
  return `${role || ''}|${fnv1a(norm)}`
}

/**
 * 近重复抑制：把「内容相同/近同」的块跨会话合并成一条。
 * - 保留分最高的那条（调用方按分数降序传入），其余并入 duplicateCount / duplicateTimes / duplicateSessions
 * - 不删除原始字段；被合并掉的 hit 不单独占位
 * - 某场会话的 hits 全被合并时，该会话不再返回（它没有独有内容）
 * @param {Array<{session:string, hits:Array<{text:string, role:string, time:string}>}>} sessions
 * @param {{ dedupe?: boolean }} opts
 */
export function dedupeSessionHits(sessions, { dedupe = true } = {}) {
  if (!dedupe) return sessions
  const seen = new Map()
  const out = []
  for (const s of sessions) {
    const kept = []
    for (const h of s.hits || []) {
      const fp = fingerprint(h.text, h.role)
      const prev = seen.get(fp)
      if (prev) {
        prev.duplicateCount = (prev.duplicateCount || 0) + 1
        if (!prev.duplicateTimes) prev.duplicateTimes = []
        if (h.time && !prev.duplicateTimes.includes(h.time)) prev.duplicateTimes.push(h.time)
        if (!prev.duplicateSessions) prev.duplicateSessions = []
        if (s.session && !prev.duplicateSessions.includes(s.session)) prev.duplicateSessions.push(s.session)
      } else {
        const hit = { ...h, duplicateCount: 0 }
        seen.set(fp, hit)
        kept.push(hit)
      }
    }
    if (kept.length) out.push({ ...s, hits: kept })
  }
  return out
}

/**
 * freshFirst=true 时，会话按「最近一次出现时间」降序排（同时间再按分数）。
 * 默认 false：保持 rankQuery 的分数排序，行为与 0.2.5 一致。
 */
export function applyFreshFirst(sessions, freshFirst = false) {
  if (!freshFirst) return sessions
  return [...sessions].sort((a, b) => {
    const dt = new Date(b.end).getTime() - new Date(a.end).getTime()
    if (dt) return dt
    return (b.score || 0) - (a.score || 0)
  })
}

/**
 * 把 rankQuery 的 grouped 结果构造成对外返回的 sessions（index.js 与端到端脚本共用）。
 * 顺序：构造全部 → 跨会话去重 → 可选补位 → 可选新块优先 → 截断 maxSessions。
 * 只加字段，不删 0.2.5 已有的 session / start / end / score / time / role / messageId / seq / text。
 *
 * @param {boolean} fillAfterDedupe 去重后不足 maxSessions 时，把被合并掉的会话按原分补回来
 *   （补回来的场次带 `restoredByFill: true`；默认 false，行为与 0.3.0 一致）
 */
export function buildRankedSessions(r, chunks, { maxSessions = 3, dedupe = true, freshFirst = false, nowMs = Date.now(), minRatio = 0.35, fillAfterDedupe = false } = {}) {
  const maxGroupScore = r.grouped?.[0]?.score || 0
  const relevant = (r.grouped || []).filter((g) => g.score >= maxGroupScore * minRatio)
  const built = relevant.map((g) => {
    const items = g.items.slice(0, 3)
    const times = g.items.map((i) => chunks[i].t)
    const startMs = Math.min(...times)
    const endMs = Math.max(...times)
    return {
      session: g.session,
      workspace: g.wsPretty || g.ws,
      start: new Date(startMs).toISOString(),
      startDateText: dateFields(startMs, nowMs).dateText,
      end: new Date(endMs).toISOString(),
      endDateText: dateFields(endMs, nowMs).dateText,
      score: Number(g.score.toFixed(4)),
      hits: items.map((i) => {
        const c = chunks[i]
        return {
          time: new Date(c.t).toISOString(),
          ...dateFields(c.t, nowMs),
          role: c.role,
          messageId: c.msgId || null,
          seq: c.seq ?? null,
          text: c.text.length > 400 ? `${c.text.slice(0, 400)}…` : c.text,
        }
      }),
    }
  })
  let sessions = dedupeSessionHits(built, { dedupe })
  if (fillAfterDedupe && sessions.length < maxSessions && built.length > sessions.length) {
    const present = new Set(sessions.map((s) => s.session))
    for (const s of built) {
      if (sessions.length >= maxSessions) break
      if (present.has(s.session)) continue
      present.add(s.session)
      sessions.push({ ...s, restoredByFill: true })
    }
    // 补位后按原分数顺序（built 已按分数降序）重排，避免补回来的场次排到末尾
    const rank = new Map(built.map((s, i) => [s.session, i]))
    sessions.sort((a, b) => (rank.get(a.session) ?? 0) - (rank.get(b.session) ?? 0))
  }
  return applyFreshFirst(sessions, freshFirst).slice(0, maxSessions)
}
