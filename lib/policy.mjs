/**
 * lib/policy.mjs —— 源工作区策略（纯函数，便于验收）
 *
 * 二期：多源 + 分库。规则：
 *   · 一个工作区只能归一个源（源之间互斥；按数组顺序先到先得）
 *   · 一个源可以包含任意多个工作区（包括全部）——互斥是「源与源之间」的事
 *   · 真正索引 = 在某个源的白名单里（有源时旧「排除清单」不参与）
 *   · 能不能检索 = 调用方工作区属于哪个源，就查哪个库；不属于任何源 ⇒ 拒绝
 *   · 没有源 = 老行为（全部工作区共用一个库）
 */

/** 解析 sources（JSON 字符串）→ [{ id, name, workspaces }]；坏数据一律当「没有源」 */
export function parseSources(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  let arr
  try { arr = JSON.parse(s) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const out = []
  const seen = new Set()
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const rawWs = Array.isArray(it.workspaces) ? it.workspaces : []
    const workspaces = []
    for (const x of rawWs) {
      const w = String(x || '').trim()
      if (!w || seen.has(w)) continue // 互斥：后面的源不能抢已归属的工作区
      seen.add(w)
      workspaces.push(w)
    }
    // 空源保留：用户新建还没勾工作区时，得让它存在
    out.push({
      id: String(it.id || '').trim() || `src${out.length + 1}`,
      name: String(it.name || '').trim() || `源${out.length + 1}`,
      workspaces,
    })
  }
  return out
}

/** 兼容旧调用：第一档源（可能是空源）；null = 没有源 */
export function primarySource(cfg) {
  return parseSources(cfg?.sources)[0] || null
}

/** 兼容旧调用：第一档源的白名单；null = 不限制；[] = 有源但为空（什么都不索引） */
export function allowWorkspaces(cfg) {
  const s = primarySource(cfg)
  return s ? s.workspaces : null
}

/**
 * 建索引时用的过滤器。
 *
 * @param {string[]|null} wsAllow 源白名单；null = 不限制；[] = 空源（全挡）
 * @param {string} excludeWorkspaces 旧排除清单（只在没有源时生效）
 * @returns {{ allowSet: Set<string>|null, skip: string[], ok: (ws:string)=>boolean, active: boolean }}
 */
export function makeWsFilter(wsAllow, excludeWorkspaces) {
  const hasAllow = Array.isArray(wsAllow)
  const allowSet = hasAllow ? new Set(wsAllow.map(String)) : null
  // 有源时：源的勾选就是唯一真相，旧排除清单不参与（否则会出现「勾上了却不索引」的幽灵拦路）
  const skip = allowSet ? [] : String(excludeWorkspaces || '')
    .split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
  const ok = (ws) => {
    const w = String(ws || '')
    if (allowSet && !allowSet.has(w)) return false
    if (skip.length && skip.some((s) => w.includes(s))) return false
    return true
  }
  return { allowSet, skip, ok, active: Boolean(allowSet || skip.length) }
}

/** 某个工作区属于哪个源（互斥：先到先得） */
export function findSourceForWorkspace(wsDir, sources) {
  if (!wsDir || !Array.isArray(sources)) return null
  for (const s of sources) if (s.workspaces.includes(wsDir)) return s
  return null
}

/** 全部归属表：ws → srcId */
export function workspaceOwners(sources) {
  const m = new Map()
  for (const s of Array.isArray(sources) ? sources : []) {
    for (const ws of s.workspaces) if (!m.has(ws)) m.set(ws, s.id)
  }
  return m
}

/**
 * 调用方应该查哪个库。
 * @returns {{ source: object, scope: string }|null} null = 不属于任何源
 */
export function routeCaller(wsDir, sources) {
  const s = findSourceForWorkspace(wsDir, sources)
  return s ? { source: s, scope: s.id } : null
}

/** 调用方能否在这个源里检索（单源兼容版） */
export function callerInSource(callerWsDir, src) {
  if (!src) return true
  if (!callerWsDir) return false
  return src.workspaces.includes(callerWsDir)
}
