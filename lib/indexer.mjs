/**
 * lib/indexer.mjs —— 建索引 / 增量索引 / 后台任务编排
 *
 * 规矩：
 *   · 任何后台任务都不许把异常外冒（未捕获异常会带走整个宿主进程）
 *   · **同一个库**同一时刻只允许一个建索引任务（按 scope 加锁；不同库可并行）
 *   · 只读 sessions 目录；索引写 $DSH_HOME/session-recall/{index | scopes/<scope>/index}
 *
 * 二期：所有落盘与状态都按 scope（源 id）分开；不传 scope = 老的单库。
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildChunks, chunkKey } from './chunk.mjs'
import { extractSessions } from './extract.mjs'
import { embedDocuments, EmbedError, DEFAULT_MODELS, normalizeProvider } from './embed.mjs'
import { loadIndex, saveIndex } from './vectorstore.mjs'
import { sessionsRoot, stateDir, statePath, logPath } from './paths.mjs'
import { makeWsFilter } from './policy.mjs'

/** scopeKey → running promise */
const runningByScope = new Map()
/** scopeKey → last state */
const lastStateByScope = new Map()
const sk = (scope) => (scope ? String(scope) : '')

async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

async function appendLog(line, scope = null) {
  try {
    await mkdir(dirname(logPath(scope)), { recursive: true })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(logPath(scope), `${new Date().toISOString()}  ${line}\n`, 'utf8')
  } catch { /* 日志写不进去也不致命 */ }
}

async function saveState(patch, scope = null) {
  const k = sk(scope)
  const next = { ...(lastStateByScope.get(k) || { phase: 'idle' }), ...patch }
  lastStateByScope.set(k, next)
  try { await writeAtomic(statePath(scope), JSON.stringify(next, null, 1)) } catch { /* 忽略 */ }
}

export function isBuilding(scope = null) {
  return runningByScope.has(sk(scope))
}

export function currentBuildState(scope = null) {
  const k = sk(scope)
  return { ...(lastStateByScope.get(k) || { phase: 'idle' }), busy: runningByScope.has(k) }
}

export async function readBuildState(scope = null) {
  try { return JSON.parse(await readFile(statePath(scope), 'utf8')) } catch { return null }
}

/** 索引与当前配置是否兼容（换 provider / 换模型 ⇒ 向量不可比，必须重建） */
function compatible(meta, cfg) {
  if (!meta) return false
  const wantProvider = normalizeProvider(cfg.provider)
  const wantModel = cfg.model || DEFAULT_MODELS[wantProvider] || ''
  if (normalizeProvider(meta.provider) !== wantProvider) return false
  if (wantProvider !== 'none' && (meta.model || '') !== wantModel) return false
  return true
}

/**
 * 建 / 增量。返回 { ok, added, total, skipped?, error? }
 * @param {object} opts { cfg, days?, force?, wsAllow?, scope?, signal?, onProgress? }
 *   wsAllow: 源工作区白名单（会话目录名数组，精确匹配）；null/空 = 不限制
 *   scope:   源 id；null = 老的单库
 */
export async function buildIndex({ cfg: rawCfg, days, force = false, wsAllow = null, scope = null, signal, onProgress } = {}) {
  const k = sk(scope)
  if (runningByScope.has(k)) return { ok: false, error: 'already-running', state: currentBuildState(scope) }
  // provider 一律归一（兼容旧值 siliconflow / ollama）
  const cfg = { ...rawCfg, provider: normalizeProvider(rawCfg.provider) }
  const promise = (async () => {
    const t0 = Date.now()
    const d = Math.max(1, Number(days || cfg.indexDays) || 7)
    await saveState({ phase: 'building', startedAt: new Date().toISOString(), error: null, progress: 0 }, scope)
    await appendLog(`开始建索引：近 ${d} 天，provider=${cfg.provider}，model=${cfg.model || DEFAULT_MODELS[cfg.provider] || '(无)'}`, scope)

    try {
      // ① 抽取
      await saveState({ stage: 'extract' }, scope)
      // 源白名单 ∩ 排除名单（与查询准入共用 lib/policy.mjs 的同一份规则）
      const { allowSet, ok: wsOk, active: wsActive } = makeWsFilter(wsAllow, cfg.excludeWorkspaces)
      const { recs, fileCount } = await extractSessions({
        root: sessionsRoot(),
        days: d,
        signal,
        wsFilter: wsActive ? wsOk : undefined,
        onProgress: (p, label) => {
          onProgress?.('extract', p, label)
          saveState({ progress: p * 0.2, label }, scope).catch(() => {})
        },
      })
      await appendLog(`抽取完成：${fileCount} 个会话文件 → ${recs.length} 条消息`, scope)
      if (!recs.length) {
        await saveState({ phase: 'idle', doneAt: new Date().toISOString(), lastBuildAt: new Date().toISOString(), chunks: 0, progress: 1 }, scope)
        return { ok: true, added: 0, total: 0, note: '最近这段时间没有可索引的对话' }
      }

      // ② 切块
      const fresh = buildChunks(recs)
      const old = force ? null : await loadIndex(scope)
      const reuse = new Map()
      if (old && compatible(old.meta, cfg)) {
        for (let i = 0; i < old.meta.chunks.length; i++) {
          reuse.set(chunkKey(old.meta.chunks[i]), { chunk: old.meta.chunks[i], vec: old.meta.chunks[i].text, vecIndex: i, loaded: old })
        }
      }

      // ③ 增量：只嵌「新的 / 变过的」块
      const kept = []
      const toEmbed = []
      for (const c of fresh) {
        const key = chunkKey(c)
        const prev = reuse.get(key)
        if (prev && prev.chunk.text === c.text) kept.push({ chunk: c, vec: oldVector(old, prev.vecIndex) })
        else toEmbed.push(c)
      }
      await appendLog(`切块 ${fresh.length}；复用 ${kept.length}；需嵌入 ${toEmbed.length}`, scope)

      let newVecs = []
      if (cfg.provider !== 'none' && toEmbed.length) {
        await saveState({ stage: 'embed', progress: 0.25 }, scope)
        newVecs = await embedDocuments(toEmbed.map((c) => c.text), cfg, {
          signal,
          onProgress: (p) => {
            onProgress?.('embed', p)
            saveState({ stage: 'embed', progress: 0.25 + p * 0.7 }, scope).catch(() => {})
          },
        })
      }

      // ④ 组装：保留旧的历史块（不删，避免「上周说过的话」被这次窗口冲掉），再接新块
      const mergedChunks = []
      const mergedVecs = []
      const seen = new Map() // key → merged index
      if (old && compatible(old.meta, cfg) && !force) {
        for (let i = 0; i < old.meta.chunks.length; i++) {
          const c = old.meta.chunks[i]
          // 源白名单 / 排除名单收紧 ⇒ 旧块也要跟着掉出去
          if (!wsOk(String(c.ws || ''))) continue
          const key = chunkKey(c)
          if (seen.has(key)) continue
          seen.set(key, mergedChunks.length)
          mergedChunks.push(c)
          mergedVecs.push(cfg.provider === 'none' ? [] : oldVector(old, i))
        }
      }
      for (let i = 0; i < toEmbed.length; i++) {
        const c = toEmbed[i]
        const key = chunkKey(c)
        if (seen.has(key)) continue
        seen.set(key, mergedChunks.length)
        mergedChunks.push(c)
        mergedVecs.push(newVecs[i] || [])
      }
      // 复用过的块：文本有更新则替换
      for (const { chunk, vec } of kept) {
        const idx = seen.get(chunkKey(chunk))
        if (idx !== undefined) { mergedChunks[idx] = chunk; mergedVecs[idx] = vec }
      }

      // ⑤ 保留窗口：max(indexDays, 30) 天，防止索引无限长
      const keepDays = Math.max(Number(cfg.indexDays) || 7, 30)
      const cutoff = Date.now() - keepDays * 86400000
      const keepIdx = []
      for (let i = 0; i < mergedChunks.length; i++) if (mergedChunks[i].t >= cutoff) keepIdx.push(i)

      const finalChunks = keepIdx.map((i) => mergedChunks[i])
      const finalVecs = cfg.provider === 'none' ? [] : keepIdx.map((i) => mergedVecs[i])
      const meta = {
        provider: cfg.provider,
        model: cfg.provider === 'none' ? '' : (cfg.model || DEFAULT_MODELS[cfg.provider] || ''),
        dim: cfg.provider === 'none' ? 0 : (finalVecs[0]?.length || 0),
        builtAt: new Date().toISOString(),
        windowDays: d,
        keepDays,
        chunkSize: 1200,
        sessions: new Set(finalChunks.map((c) => c.session)).size,
        chunks: finalChunks,
        wsAllow: allowSet ? [...allowSet] : null,
        scope: scope || null,
      }
      await saveIndex(meta, finalVecs, scope)

      const ms = Date.now() - t0
      await saveState({
        phase: 'idle', stage: 'done', progress: 1,
        lastBuildAt: meta.builtAt, doneAt: new Date().toISOString(),
        chunks: finalChunks.length, added: toEmbed.length, sessions: meta.sessions,
        durationMs: ms, error: null, errorHint: null, label: '',
      }, scope)
      await appendLog(`完成：总块 ${finalChunks.length}（新增 ${toEmbed.length}），用时 ${(ms / 1000).toFixed(1)}s`, scope)
      return { ok: true, added: toEmbed.length, total: finalChunks.length, sessions: meta.sessions, ms }
    } catch (e) {
      const msg = e instanceof EmbedError ? `${e.code}: ${e.message}` : String(e?.message || e)
      const hint = e instanceof EmbedError
        ? (e.code === 'NO_KEY' ? '去设置页填「嵌入 API Key」，或把嵌入来源改成 none（只做字面检索）'
          : e.code === 'NO_EMBED' ? 'Ollama 需要带 --embeddings 启动；不打算本地嵌入就改回 siliconflow 或 none'
            : '检查网络与 Key')
        : ''
      await saveState({ phase: 'error', stage: 'error', error: msg, errorHint: hint, doneAt: new Date().toISOString() }, scope)
      await appendLog(`失败：${msg}${hint ? `（${hint}）` : ''}`, scope)
      return { ok: false, error: msg, hint, chunks: (lastStateByScope.get(k) || {}).chunks || 0 }
    } finally {
      runningByScope.delete(k)
    }
  })()

  runningByScope.set(k, promise)
  return promise
}

/** 旧向量用**视图**取（不复制）：2548 块 × 4096 维整份复制会白吃 80MB */
function oldVector(loaded, i) {
  if (!loaded || !loaded.dim) return []
  return loaded.vecs.subarray(i * loaded.dim, (i + 1) * loaded.dim)
}
