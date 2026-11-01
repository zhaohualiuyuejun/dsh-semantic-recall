/**
 * lib/embed.mjs —— 嵌入通道（纯 HTTP，不带任何原生依赖）
 *
 *   cloud : 云端 OpenAI 兼容 /v1/embeddings（直连，不走系统代理）
 *   local : 本机嵌入服务 /api/embed（默认 Ollama，**必须带 --embeddings 启动**）
 *   none  : 不做嵌入 —— 退回纯字面检索（BM25）
 *
 * 兼容旧值：siliconflow → cloud、ollama → local。
 * ⚠️ 查询要用 Qwen3-Embedding 官方推荐的 Instruct 前缀（文档不加），显著提升召回。
 */

export const QUERY_INSTRUCT = 'Instruct: Given a user\'s colloquial question, retrieve the relevant past conversation from the assistant\'s history\nQuery: '

export const DEFAULT_MODELS = {
  cloud: 'Qwen/Qwen3-Embedding-8B',
  local: 'bge-m3',
}

/** 旧配置值 → 新值（保持向后兼容） */
export function normalizeProvider(p) {
  const v = String(p || '').trim().toLowerCase()
  if (v === 'siliconflow') return 'cloud'
  if (v === 'ollama') return 'local'
  return v || 'none'
}

export class EmbedError extends Error {
  constructor(message, code = 'EMBED_ERROR') {
    super(message)
    this.code = code
  }
}

function norm(v) {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  return n ? v.map((x) => x / n) : v
}

async function postJson(url, body, { headers = {}, timeoutMs = 120000 } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try { detail = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || detail } catch { /* 原样 */ }
    throw new EmbedError(`HTTP ${res.status}：${detail}`, `HTTP_${res.status}`)
  }
  try { return JSON.parse(text) } catch (e) { throw new EmbedError('返回不是 JSON：' + text.slice(0, 200)) }
}

export const DEFAULT_BASES = {
  cloud: 'https://api.siliconflow.cn/v1',
  local: 'http://127.0.0.1:11434',
}

/**
 * 把落单的 UTF-16 代理项（emoji 被按字符截断成半截）替换成 U+FFFD。
 * 不解掉的话 JSON.stringify 会写出 \ud83d 这类孤立转义，服务端直接判 400（且连坐整批）。
 */
export function sanitizeText(s) {
  return String(s ?? '').replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  )
}

async function embedSiliconFlow(texts, model, apiKey, { onProgress, batch = 16, signal, base } = {}) {
  if (!apiKey) {
    throw new EmbedError('没有填 API Key（config.json 里的 apiKey）', 'NO_KEY')
  }
  const endpoint = `${(base || DEFAULT_BASES.cloud).replace(/\/+$/, '')}/embeddings`
  const out = []
  for (let i = 0; i < texts.length; i += batch) {
    if (signal?.aborted) throw new EmbedError('已取消', 'ABORTED')
    const part = texts.slice(i, i + batch).map(sanitizeText)
    let d
    try {
      d = await postJson(endpoint, { model, input: part }, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    } catch (error) {
      // 批量被拒时不要整批放弃：逐条重试，坏块用 null 占位跳过（拿不到向量总比全废好）。
      if (error?.code !== 'HTTP_400' || part.length <= 1) throw error
      console.warn(`[session-recall] 批量嵌入被拒（${error?.message}），改为逐条重试，坏的那块跳过`)
      for (const one of part) {
        const single = await postJson(endpoint, { model, input: [one] }, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }).catch(() => null)
        const row = single?.data?.[0]
        out.push(row?.embedding ? norm(row.embedding) : null)
      }
      onProgress?.(Math.min(i + batch, texts.length) / texts.length)
      continue
    }
    if (!Array.isArray(d?.data)) throw new EmbedError('返回里没有 data：' + JSON.stringify(d).slice(0, 200))
    const rows = [...d.data].sort((a, b) => a.index - b.index)
    for (const r of rows) out.push(norm(r.embedding))
    onProgress?.(Math.min(i + batch, texts.length) / texts.length)
  }
  return out
}

async function embedOllama(texts, model, { onProgress, signal, base } = {}) {
  const out = []
  const step = 16
  const endpoint = `${(base || DEFAULT_BASES.local).replace(/\/+$/, '')}/api/embed`
  for (let i = 0; i < texts.length; i += step) {
    if (signal?.aborted) throw new EmbedError('已取消', 'ABORTED')
    const part = texts.slice(i, i + step)
    const d = await postJson(endpoint, { model, input: part }, { timeoutMs: 300000 })
    if (!Array.isArray(d?.embeddings)) {
      throw new EmbedError(
        'Ollama 没返回 embeddings。多半是它没带 `--embeddings` 启动（或没有嵌入模型）。'
        + '返回：' + JSON.stringify(d).slice(0, 200),
        'NO_EMBED',
      )
    }
    for (const v of d.embeddings) out.push(norm(v))
    onProgress?.(Math.min(i + step, texts.length) / texts.length)
  }
  return out
}

/** 批量嵌入（文档）。provider=none 返回 null。 */
export async function embedDocuments(texts, cfg, opts = {}) {
  if (!texts.length) return []
  texts = texts.map(sanitizeText) // 本地/云端都先洗干净，避免整批被孤立代理项带崩
  const provider = normalizeProvider(cfg.provider)
  const model = cfg.model || DEFAULT_MODELS[provider] || ''
  if (provider === 'cloud') return embedSiliconFlow(texts, model, cfg.apiKey, { ...opts, base: cfg.apiBase })
  if (provider === 'local') return embedOllama(texts, model, { ...opts, base: cfg.localBase })
  if (provider === 'none') return null
  throw new EmbedError(`未知的嵌入来源：${provider}`, 'BAD_PROVIDER')
}

/** 单条查询嵌入（带 Instruct 前缀） */
export async function embedQuery(text, cfg) {
  const provider = normalizeProvider(cfg.provider)
  if (provider === 'none') return null
  const model = cfg.model || DEFAULT_MODELS[provider] || ''
  const prefixed = QUERY_INSTRUCT + sanitizeText(text)
  if (provider === 'cloud') return embedSiliconFlow([prefixed], model, cfg.apiKey, { base: cfg.apiBase })
  if (provider === 'local') return embedOllama([prefixed], model, { base: cfg.localBase })
  throw new EmbedError(`未知的嵌入来源：${provider}`, 'BAD_PROVIDER')
}

export function cosine(a, b) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}
