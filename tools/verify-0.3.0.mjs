/**
 * tools/verify-0.3.0.mjs —— 验证 0.3.0 返回层五项（不联网、不碰真实会话）
 *
 *   A1 候选编号化：fallback_menu.sessions 每条有 index / label
 *   A2 日期就地给：hits 每条有 dateText / dateHuman / ageDays；会话有 startDateText / endDateText
 *   D1 近重复抑制：同一句在 3 场会话出现 → 1 条 + duplicateCount=2；dedupe=false 时与 0.2.5 一致
 *   D2 时效暴露：isRecent；freshFirst 排序可开可关
 *   向后兼容：不删旧字段（session / time / text / role / seq 全在）
 *
 * 跑法：node tools/verify-0.3.0.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const url = (...p) => pathToFileURL(join(root, ...p)).href

let fail = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fail++
}

const { dateFields, fingerprint, dedupeSessionHits, applyFreshFirst, buildRankedSessions } = await import(url('lib', 'present.mjs'))

const DAY = 86400000
const now = Date.now()

// ── A2 / D2：日期字段 ────────────────────────────────────────────────
const d0 = dateFields(now, now)
ok(/^\d{4}-\d{2}-\d{2}$/.test(d0.dateText), 'dateText 是本地时区 YYYY-MM-DD', d0.dateText)
ok(/^\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(d0.dateHuman), 'dateHuman 是 M月D日 HH:mm', d0.dateHuman)
ok(d0.ageDays === 0, '今天的 ageDays=0')
ok(d0.isRecent === true, '今天是 isRecent')

const d3 = dateFields(now - 3 * DAY, now)
ok(d3.ageDays === 3, '3 天前 ageDays=3', String(d3.ageDays))
ok(d3.isRecent === true, '3 天前在 7 天内 → isRecent=true')

const d10 = dateFields(now - 10 * DAY, now)
ok(d10.ageDays === 10, '10 天前 ageDays=10', String(d10.ageDays))
ok(d10.isRecent === false, '10 天前 → isRecent=false')

// ── D1：近重复抑制 ───────────────────────────────────────────────────
const mkSessions = () => ([
  { session: 'sess-a', end: new Date(now - 1 * DAY).toISOString(), score: 0.9, hits: [
    { time: new Date(now - 1 * DAY).toISOString(), role: 'user', text: '  缓存没清，重启一下就好。 ', seq: 1, messageId: 'm1' },
  ] },
  { session: 'sess-b', end: new Date(now - 2 * DAY).toISOString(), score: 0.8, hits: [
    { time: new Date(now - 2 * DAY).toISOString(), role: 'user', text: '缓存没清，重启一下就好。', seq: 2, messageId: 'm2' },
  ] },
  { session: 'sess-c', end: new Date(now - 3 * DAY).toISOString(), score: 0.7, hits: [
    { time: new Date(now - 3 * DAY).toISOString(), role: 'user', text: '缓存没清，重启一下就好。', seq: 3, messageId: 'm3' },
  ] },
])

const deduped = dedupeSessionHits(mkSessions(), { dedupe: true })
const allHits = deduped.flatMap((s) => s.hits)
ok(allHits.length === 1, '同一句在 3 场会话 → 合并成 1 条', `实际 ${allHits.length}`)
ok(allHits[0]?.duplicateCount === 2, 'duplicateCount=2', String(allHits[0]?.duplicateCount))
ok(Array.isArray(allHits[0]?.duplicateTimes) && allHits[0].duplicateTimes.length === 2, 'duplicateTimes 记录另外两次时间')
ok(allHits[0]?.duplicateSessions?.length === 2, 'duplicateSessions 记录另外两场会话')
ok(allHits[0]?.seq === 1 && allHits[0]?.messageId === 'm1', '保留第一次出现的原始字段（seq / messageId）')
ok(deduped.length === 1, '被合并光的会话不再返回（只剩 1 场）', String(deduped.length))

const raw = dedupeSessionHits(mkSessions(), { dedupe: false })
const rawHits = raw.flatMap((s) => s.hits)
ok(rawHits.length === 3, 'dedupe=false 时与 0.2.5 一致（3 条都在）', String(rawHits.length))
ok(rawHits.every((h) => h.duplicateCount === undefined), 'dedupe=false 时不加 duplicateCount')

// 不同 role 同文本不合并（用户原话 vs AI 复述是两条信息）
const mixed = dedupeSessionHits([
  { session: 's1', end: new Date(now).toISOString(), score: 0.9, hits: [{ time: new Date(now).toISOString(), role: 'user', text: '好的' }] },
  { session: 's2', end: new Date(now).toISOString(), score: 0.8, hits: [{ time: new Date(now).toISOString(), role: 'assistant', text: '好的' }] },
], { dedupe: true })
ok(mixed.flatMap((s) => s.hits).length === 2, '不同 role 的同文本不合并')
ok(fingerprint('a b', 'user') === fingerprint(' a  b ', 'user'), '指纹对空白归一化')

// ── D2：freshFirst ──────────────────────────────────────────────────
const two = [
  { session: 'old-high', end: new Date(now - 10 * DAY).toISOString(), score: 0.9, hits: [] },
  { session: 'new-low', end: new Date(now - 1 * DAY).toISOString(), score: 0.7, hits: [] },
]
ok(applyFreshFirst(two, false)[0].session === 'old-high', 'freshFirst=false 保持原顺序（与 0.2.5 一致）')
ok(applyFreshFirst(two, true)[0].session === 'new-low', 'freshFirst=true 时新块优先')

// ── 构造返回结构：buildRankedSessions（index.js 与端到端共用）────────
const fchunks = [
  { session: 'sess-a', t: now - 1 * DAY, role: 'user', text: '缓存没清，重启一下就好。', ws: 'w', wsPretty: 'w' },
  { session: 'sess-b', t: now - 2 * DAY, role: 'user', text: '缓存没清，重启一下就好。', ws: 'w', wsPretty: 'w' },
  { session: 'sess-c', t: now - 3 * DAY, role: 'user', text: '完全不同的另一件事。', ws: 'w', wsPretty: 'w' },
]
const fakeRanked = { grouped: [
  { session: 'sess-a', ws: 'w', wsPretty: 'w', score: 0.9, items: [0] },
  { session: 'sess-b', ws: 'w', wsPretty: 'w', score: 0.8, items: [1] },
  { session: 'sess-c', ws: 'w', wsPretty: 'w', score: 0.7, items: [2] },
] }
const built = buildRankedSessions(fakeRanked, fchunks, { maxSessions: 3, dedupe: true, freshFirst: false, nowMs: now })
ok(built.length === 2, 'buildRankedSessions 去重后剩 2 场', String(built.length))
const builtHits = built.flatMap((s) => s.hits)
ok(builtHits.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.dateText) && typeof h.dateHuman === 'string'
  && typeof h.ageDays === 'number' && typeof h.isRecent === 'boolean'), '真实构造出的 hits 每条都有 dateText/dateHuman/ageDays/isRecent')
ok(built.every((s) => s.startDateText && s.endDateText), '会话有 startDateText / endDateText')
ok(builtHits.every((h) => h.time && h.text && h.role && 'seq' in h && 'messageId' in h), '旧字段 time/text/role/seq/messageId 一个不删')
const builtRaw = buildRankedSessions(fakeRanked, fchunks, { dedupe: false, nowMs: now })
ok(builtRaw.flatMap((s) => s.hits).length === 3, 'dedupe=false 时 3 条都在（与 0.2.5 一致）')
const builtFresh = buildRankedSessions(fakeRanked, fchunks, { dedupe: true, freshFirst: true, nowMs: now })
ok(builtFresh[0]?.session === 'sess-a', 'freshFirst=true 时最新的 sess-a 在前', builtFresh[0]?.session)

// ── D3：去重后补位（默认关）────────────────────────────────────────
const builtFill = buildRankedSessions(fakeRanked, fchunks, { maxSessions: 3, dedupe: true, fillAfterDedupe: true, nowMs: now })
ok(builtFill.length === 3, 'fillAfterDedupe=true 时补回被合并的会话（3 场）', String(builtFill.length))
ok(builtFill.some((s) => s.restoredByFill === true && s.session === 'sess-b'), '补回的场次带 restoredByFill:true 且是 sess-b')
ok(builtFill.map((s) => s.session).join(',') === 'sess-a,sess-b,sess-c', '补位后按原分数顺序重排', builtFill.map((s) => s.session).join(','))
const builtNoFill = buildRankedSessions(fakeRanked, fchunks, { maxSessions: 3, dedupe: true, nowMs: now })
ok(builtNoFill.length === 2, 'fillAfterDedupe 默认 false，行为不变（仍 2 场）', String(builtNoFill.length))
const builtFillOff = buildRankedSessions(fakeRanked, fchunks, { maxSessions: 3, dedupe: false, fillAfterDedupe: true, nowMs: now })
ok(builtFillOff.length === 3 && !builtFillOff.some((s) => s.restoredByFill), 'dedupe=false 时补位不触发（无需补）')

// ── A1 / 接线：读 index.js + present.mjs 源码核对 ───────────────────
const src = await readFile(join(root, 'index.js'), 'utf8')
const presentSrc = await readFile(join(root, 'lib', 'present.mjs'), 'utf8')
ok(/index:\s*i \+ 1/.test(src), 'A1：fallback_menu.sessions 有 index（从 1 起）')
ok(/label:\s*`\$\{df\.dateText\} · /.test(src), 'A1：有可读 label（日期 · 预览）')
ok(/先列编号候选/.test(src), 'A1：note 主指令是「先列编号候选，问第几个」')
ok(/\.\.\.dateFields\(c\.t, nowMs\)/.test(presentSrc), 'A2：语义 hits 每条带 dateFields')
ok(/\.\.\.dateFields\(c\.t, nowMsDirect\)/.test(src), 'A2：下钻 hits 每条带 dateFields')
ok(/startDateText: dateFields/.test(presentSrc) && /endDateText: dateFields/.test(presentSrc), 'A2：会话 start/end 同步有 dateText')
ok(/引用时\*\*必须带上每条命中里的 dateText/.test(src), 'A2：命中 note 写死「必须带 dateText」')
ok(/dedupeSessionHits\(built, \{ dedupe \}\)/.test(presentSrc), 'D1：buildRankedSessions 内接 dedupeSessionHits')
ok(/const dedupe = \(args\?\.no_dedupe === true/.test(src), 'D1：dedupe 默认 true、no_dedupe 可关')
ok(/buildRankedSessions\(r, loaded\.meta\.chunks, \{ maxSessions, dedupe, freshFirst, nowMs, fillAfterDedupe \}\)/.test(src), 'index.js 调 buildRankedSessions 并传齐参数')
ok(/const fillAfterDedupe = \(args\?\.fillAfterDedupe \?\? args\?\.fill_after_dedupe\) === true/.test(src), 'D3：fillAfterDedupe 接受 camelCase / snake_case')
ok(/fillAfterDedupe: \{ type: 'boolean'/.test(src), 'D3：工具参数表已暴露 fillAfterDedupe')
ok(/applyFreshFirst\(sessions, freshFirst\)\.slice\(0, maxSessions\)/.test(presentSrc), 'D2：freshFirst 排序后截断 maxSessions')
ok(/const freshFirst = \(args\?\.freshFirst \?\? args\?\.fresh_first\) === true/.test(src), 'D2：freshFirst 默认 false、接受 snake_case')
ok(/freshFirst: \{ type: 'boolean'/.test(src) && /dedupe: \{ type: 'boolean'/.test(src), '工具参数表已暴露 dedupe / freshFirst')

console.log(fail ? `\n❌ ${fail} 项未通过` : '\n✅ 全部通过')
process.exit(fail ? 1 : 0)
