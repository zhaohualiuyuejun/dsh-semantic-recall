/**
 * lib/workspace.mjs —— 工作区真实路径 ↔ 会话目录名
 *
 * DSH 把工作区目录编码成 `--<盘>-<段>-<段>--`：
 *   H:\deepseek\zefeila  → --H-deepseek-zefeila--
 *   H:\九洲仙魔录          → --H-~4E5D~6D32~4ED9~9B54~5F55--
 *
 * 规则（2026-10-31 用本机 13 个会话目录双向对账，13/13 通过）：
 *   · 盘符后的 `:` → `-`
 *   · `\` 与 `/`  → `-`
 *   · 非 [A-Za-z0-9_.] 的字符 → `~XXXX`（UTF-16 code unit，大写 4 位十六进制）
 *   · 前后各加 `--`
 *
 * ⚠️ `-` 不转义 ⇒ 目录名**不可逆**（路径里的连字符解回来会变成路径分隔符）。
 *    所以这里只做「路径 → 目录名」单向编码；判定一律以编码结果为准，
 *    并用 `~002D` 变体兜底（万一 DSH 哪天改了转义策略）。
 */

/** 统一成小写正斜杠、去尾斜杠（只用于比较，不用于显示） */
export function normPath(s) {
  return String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 编码成会话目录名。
 * @param {string} absPath 绝对路径（H:\x\y 或 H:/x/y）
 * @param {object} [opt] { escapeDash: true 时把 `-` 也转义成 ~002D }
 */
export function encodeWorkspaceDir(absPath, opt = {}) {
  let s = String(absPath || '').replace(/\\/g, '/')
  // 盘符：C:/x → C-/x（后面统一把 / 换 -，所以只看冒号）
  s = s.replace(/^([A-Za-z]):\/?/, '$1-')
  let out = ''
  // 按 UTF-16 code unit 遍历（与 DSH 的 ~XXXX 四位十六进制一致）
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '-') { out += opt.escapeDash ? '~002D' : '-'; continue }
    if (ch === '/') { out += '-'; continue }
    if (/[A-Za-z0-9_.]/.test(ch)) out += ch
    else out += '~' + ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()
  }
  return '--' + out + '--'
}

/** 主形式 + 连字符转义变体（判定时任一命中即算） */
export function encodeVariants(absPath) {
  const a = encodeWorkspaceDir(absPath, { escapeDash: false })
  const b = encodeWorkspaceDir(absPath, { escapeDash: true })
  return a === b ? [a] : [a, b]
}

/**
 * 把「调用方工作目录」解析成会话目录名。
 *   · 优先在 knownDirs（sessions 下真实存在的目录名）里找
 *   · cwd 可能是工作区内的子目录 ⇒ 逐级向上找，最多 10 层
 *   · knownDirs 为空（读不到 sessions）时，直接返回主编码（fail-open 的兜底）
 *
 * @param {string|null} callerPath 调用方 cwd
 * @param {string[]|null} knownDirs sessions 下的一级目录名
 * @returns {string|null}
 */
export function resolveWorkspaceDir(callerPath, knownDirs) {
  if (!callerPath) return null
  const known = Array.isArray(knownDirs) && knownDirs.length ? new Set(knownDirs) : null
  let cur = String(callerPath).replace(/[\\/]+$/, '')
  for (let i = 0; i < 10; i++) {
    for (const v of encodeVariants(cur)) {
      if (!known) return v
      if (known.has(v)) return v
    }
    const parent = cur.replace(/[\\/][^\\/]+$/, '')
    if (!parent || parent === cur) break
    if (/^[A-Za-z]:?$/.test(parent)) break
    cur = parent
  }
  return null
}
