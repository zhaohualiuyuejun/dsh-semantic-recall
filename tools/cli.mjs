/**
 * tools/cli.mjs —— 命令行调试入口（不经过 DSH，直接验证引擎）
 *
 *   node tools/cli.mjs build [provider] [days] [force]
 *   node tools/cli.mjs query "你还记得我前几天说的那个吗" [days]
 *   node tools/cli.mjs info
 */
import { buildIndex, currentBuildState } from '../lib/indexer.mjs'
import { loadIndex, indexStats } from '../lib/vectorstore.mjs'
import { embedQuery } from '../lib/embed.mjs'
import { rankQuery, dayKeyOf } from '../lib/search.mjs'
import { buildDayCards, loadDayCards } from '../lib/days.mjs'
import { stateDir } from '../lib/paths.mjs'

const [cmd, ...rest] = process.argv.slice(2)

const cfgOf = (provider = 'none') => ({
  enabled: true,
  provider,
  apiKey: process.env.SILICONFLOW_API_KEY || '',
  model: process.env.SESS_MODEL || '',
  indexDays: Number(process.env.SESS_DAYS || 7),
  daySummaries: false,
  summaryModel: 'qwen3:8b',
  autoIndex: false,
})

if (cmd === 'build') {
  const provider = rest[0] || 'none'
  const days = Number(rest[1] || 7)
  const force = rest[2] === 'force'
  const t0 = Date.now()
  const res = await buildIndex({ cfg: { ...cfgOf(provider), indexDays: days }, days, force })
  console.log(JSON.stringify(res, null, 2), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  console.log('state:', JSON.stringify(currentBuildState(), null, 2))
} else if (cmd === 'query') {
  const q = rest[0] || ''
  const days = Number(rest[1] || 7)
  const loaded = await loadIndex()
  if (!loaded) { console.log('没有索引，先 build'); process.exit(1) }
  const cfg = { ...cfgOf(loaded.meta.provider), provider: loaded.meta.provider, model: loaded.meta.model }
  let queryVec = null
  if (loaded.dim > 0 && cfg.provider !== 'none') {
    try { queryVec = (await embedQuery(q, cfg))[0] } catch (e) { console.log('嵌入失败，降级字面：', e.code, e.message) }
  }
  const t0 = Date.now()
  const r = rankQuery({ query: q, loaded, queryVec, days })
  console.log(`查询：${q}  (${Date.now() - t0}ms, ${r.lexOnly ? '字面' : '语义+字面'})`)
  console.log(`found=${r.found} topScore=${r.topScore.toFixed(3)} cue=${r.cue?.label || '-'} 会话数=${r.grouped.length}`)
  for (const g of r.grouped.slice(0, 3)) {
    console.log(`\n[${g.score.toFixed(3)}] ${g.wsPretty} / ${g.session.slice(0, 10)}  (${g.items.length} 块)`)
    for (const i of g.items.slice(0, 3)) {
      const c = loaded.meta.chunks[i]
      const d = new Date(c.t).toISOString().slice(5, 16).replace('T', ' ')
      console.log(`   · ${d} ${c.role === 'user' ? '主人' : 'AI'}：${c.text.slice(0, 120).replace(/\n/g, ' ')}`)
    }
  }
} else if (cmd === 'days') {
  const loaded = await loadIndex()
  if (!loaded) { console.log('没有索引'); process.exit(1) }
  const model = rest[1] || process.env.SESS_SUMMARY_MODEL || 'qwen3:8b'
  const r = await buildDayCards({ chunks: loaded.meta.chunks, days: Number(rest[0] || 7), model, onProgress: (i, n, d) => console.log(`  ${i}/${n} ${d}`) })
  console.log(r)
  console.log(JSON.stringify(await loadDayCards(), null, 1).slice(0, 2000))
} else if (cmd === 'info') {
  console.log(JSON.stringify({ stateDir: stateDir(), index: await indexStats(), build: currentBuildState() }, null, 2))
} else {
  console.log('用法：build [provider:none] [days] [force] | query "..." [days] | days [n] [本地模型] | info')
}
