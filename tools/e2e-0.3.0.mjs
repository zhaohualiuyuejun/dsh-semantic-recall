/**
 * tools/e2e-0.3.0.mjs —— 真实索引端到端（只读，不建索引、不写会话）
 *
 *   拿本机真实索引跑一次检索，检查 0.3.0 返回结构：
 *   hits 每条有 dateText / dateHuman / ageDays / isRecent；会话有 startDateText / endDateText；
 *   近重复抑制前后条数对比；旧字段一个不少。
 *
 * 跑法：node tools/e2e-0.3.0.mjs "你记得那个缓存的事吗" [days]
 * 说明：云端嵌入失败会自动降级为字面检索，结构检查不受影响（此时 topScore 会低）。
 */
import { loadIndex } from '../lib/vectorstore.mjs'
import { embedQuery } from '../lib/embed.mjs'
import { rankQuery } from '../lib/search.mjs'
import { buildRankedSessions } from '../lib/present.mjs'

const q = process.argv[2] || '你还记得我前几天说的那个吗'
const days = Number(process.argv[3] || 30)

const loaded = await loadIndex()
if (!loaded) { console.log('❌ 没有索引，先 node tools/cli.mjs build [provider] [days]'); process.exit(1) }

let queryVec = null
if (loaded.dim > 0 && loaded.meta.provider !== 'none') {
  try {
    const cfg = { provider: loaded.meta.provider, model: loaded.meta.model, apiKey: process.env.SILICONFLOW_API_KEY || '' }
    queryVec = (await embedQuery(q, cfg))[0]
  } catch (e) {
    console.log('⚠️ 嵌入失败，降级字面：', e.code || '', String(e.message || e).slice(0, 100))
  }
}

const nowMs = Date.now()
const t0 = Date.now()
const r = rankQuery({ query: q, loaded, queryVec, days, nowMs })
const sessions = buildRankedSessions(r, loaded.meta.chunks, { maxSessions: 3, dedupe: true, freshFirst: false, nowMs })
const rawSessions = buildRankedSessions(r, loaded.meta.chunks, { maxSessions: 3, dedupe: false, freshFirst: false, nowMs })

const allHits = sessions.flatMap((s) => s.hits)
const rawHits = rawSessions.flatMap((s) => s.hits)

console.log(`查询：${q}  (${Date.now() - t0}ms, ${r.lexOnly ? '字面' : '语义+字面'})`)
console.log(`found=${r.found} topScore=${r.topScore.toFixed(3)} 会话=${sessions.length} 去重前/后=${rawHits.length}/${allHits.length}`)

let bad = 0
for (const s of sessions) {
  console.log(`\n[${s.score.toFixed(3)}] ${s.workspace} / ${String(s.session).slice(0, 12)}  ${s.startDateText} → ${s.endDateText}`)
  if (!s.startDateText || !s.endDateText) { console.log('  ❌ 缺 startDateText/endDateText'); bad++ }
  for (const h of s.hits) {
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(h.dateText || '') && typeof h.dateHuman === 'string'
      && typeof h.ageDays === 'number' && typeof h.isRecent === 'boolean'
    const okOld = h.time && h.text && h.role && 'seq' in h && 'messageId' in h
    if (!okDate || !okOld) bad++
    console.log(`   · ${h.dateText}（${h.dateHuman}，${h.ageDays} 天前${h.isRecent ? '，近期' : ''}）`
      + `${h.duplicateCount ? ` ×重复${h.duplicateCount}` : ''} ${h.role}：${String(h.text).slice(0, 70).replace(/\n/g, ' ')}`)
  }
}

console.log(bad ? `\n❌ ${bad} 个结构问题` : '\n✅ 端到端结构检查通过（真实索引）')
process.exit(bad ? 1 : 0)
