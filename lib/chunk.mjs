/**
 * lib/chunk.mjs —— 切块
 * 与 MVP 保持一致：1200 字一块、80 字重叠；超过 1200 的消息才切。
 */
export function chunkText(text, size = 1200, overlap = 80) {
  const t = String(text || '').trim()
  if (!t) return []
  if (t.length <= size) return [t]
  const out = []
  let i = 0
  while (i < t.length) {
    out.push(t.slice(i, i + size))
    i += size - overlap
  }
  return out
}

/** 记录 → 块。块携带来路（会话/工作区/时间/角色/分片号），供聚合与展示 */
export function buildChunks(recs, size = 1200, overlap = 80) {
  const chunks = []
  for (const r of recs) {
    const parts = chunkText(r.text, size, overlap)
    parts.forEach((p, i) => {
      chunks.push({
        session: r.session, ws: r.ws, wsPretty: r.wsPretty, t: r.t,
        role: r.role, part: i, text: p,
      })
    })
  }
  return chunks
}

/** 块指纹：会话 + 角色 + 时间 + 分片号（增量时复用旧向量） */
export function chunkKey(c) {
  return `${c.session}|${c.role}|${c.t}|${c.part}`
}
