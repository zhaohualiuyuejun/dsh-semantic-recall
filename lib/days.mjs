/**
 * lib/days.mjs —— 日摘要 / 话题卡（差异点 ②）
 *
 * 用**本机 Ollama** 把每天我说过的话提炼成 3~5 个话题卡：完全不出网、不花钱。
 * Ollama 不可用 ⇒ 返回空，调用方退回「会话列表」当候选（功能降级但不报错）。
 *
 * 落盘：$DSH_HOME/session-recall/days.json
 *   { "2026-10-30": { model, generatedAt, hash, topics:[{topic,summary,keywords}] } }
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { daysPath, stateDir } from './paths.mjs'

const DEFAULT_SUMMARY_MODEL = 'qwen3:8b'

function dayKeyOf(t) {
  const x = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

function hashOf(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export async function loadDayCards() {
  try { return JSON.parse(await readFile(daysPath(), 'utf8')) } catch { return {} }
}

async function saveDayCards(cards) {
  await mkdir(dirname(daysPath()), { recursive: true })
  const tmp = daysPath() + '.tmp'
  await writeFile(tmp, JSON.stringify(cards, null, 1), 'utf8')
  await rename(tmp, daysPath())
}

async function ollamaChat(model, messages, { timeoutMs = 120000 } = {}) {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_predict: 500, temperature: 0.3 } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const d = await res.json()
  const msg = d?.message || {}
  return String(msg.content || msg.thinking || '').trim()
}

const PROMPT = [
  '你是对话摘要助手。下面是我和 AI 助手在**某一天**的对话（只保留我说的话，按会话取样拼接）。',
  '请提炼 3~5 个「话题卡」，每张一行，用竖线分隔三样东西：话题、一句话摘要、关键词。',
  '',
  '输出形状（照这个形状写，但**换成当天真实发生的内容**）：',
  '画风训练复盘 | 训练效果没达到预期，决定先谈品质再谈开源 | 训练,品质,开源',
  '表情包编辑 | 用图片编辑做 Q 版表情包一次成功 | 表情包,图片编辑,ComfyUI',
  '',
  '硬要求：',
  '1. 只输出 3~5 行，不要标题、不要编号、不要解释、不要空行；',
  '2. 话题用 6~14 个汉字，必须是当天真实的事，**不许写「话题」「摘要」这种模板词**；',
  '3. 摘要是一句完整的话；关键词 2~4 个，用英文逗号分隔。',
  '',
  '对话：',
].join('\n')

function parseTopics(text) {
  const out = []
  const BAD = new Set(['话题', '摘要', '一句话摘要', '关键词', '示例'])
  for (const raw of String(text).split('\n')) {
    const line = raw.trim().replace(/^\d+[.、)]\s*/, '').replace(/^[-*·]\s*/, '')
    if (!line || !line.includes('|')) continue
    const parts = line.split('|').map((s) => s.trim())
    if (parts.length < 2 || !parts[0]) continue
    if (BAD.has(parts[0]) || parts[0].length > 30) continue
    out.push({
      topic: parts[0].slice(0, 40),
      summary: (parts[1] || '').slice(0, 160),
      keywords: (parts[2] || '').split(/[,，、\s]+/).filter(Boolean).slice(0, 6),
    })
    if (out.length >= 6) break
  }
  return out
}

/**
 * 一天的「摘要素材」：**按会话取样**，别让一场超长会话霸占整天
 *  - 每个会话取 1~3 条我的原话（首条 / 最长 / 末条）
 *  - 最多 12 个会话，总长 6000 字
 */
function dayDigest(items) {
  const bySession = new Map()
  for (const c of items) {
    if (!bySession.has(c.session)) bySession.set(c.session, [])
    bySession.get(c.session).push(c)
  }
  const picks = []
  for (const [, list] of bySession) {
    list.sort((a, b) => a.t - b.t)
    const first = list[0]
    const longest = list.reduce((a, b) => (b.text.length > a.text.length ? b : a), list[0])
    const last = list[list.length - 1]
    for (const c of [first, longest, last]) {
      if (!c) continue
      const t = c.text.replace(/\s+/g, ' ').trim()
      if (t.length < 10) continue
      if (picks.includes(`〔${c.wsPretty || ''}〕${t.slice(0, 400)}`)) continue
      picks.push(`〔${c.wsPretty || ''}〕${t.slice(0, 400)}`)
    }
  }
  // 按时间无法还原（picks 已按会话分组），直接拼接，控制在 6000 字
  let out = ''
  for (const p of picks) {
    if (out.length + p.length > 6000) break
    out += p + '\n'
  }
  return out
}

/**
 * 为「有对话但还没有话题卡 / 内容变了」的日子生成话题卡。
 *
 * 两种总结者：
 *   · llmCaller（不填本地模型时）：用 **DSH 自己的当前模型**（宿主 llm 服务）
 *   · model（填了本地模型时）：用本机 Ollama，完全不出网
 * @returns {Promise<{ok:boolean, generated:number, days:string[], error?:string}>}
 */
export async function buildDayCards({ chunks, days = 7, model = '', llmCaller = null, signal, onProgress, onRaw } = {}) {
  const m = String(model || '').trim()
  const call = typeof llmCaller === 'function'
    ? llmCaller
    : (m ? (msgs) => ollamaChat(m, msgs) : null)
  if (!call) return { ok: false, generated: 0, days: [], error: '没有可用的总结模型（本地模型留空且宿主 llm 服务不可用）' }
  const cards = await loadDayCards()
  const byDay = new Map()
  for (const c of chunks) {
    if (c.role !== 'user') continue
    const k = dayKeyOf(c.t)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(c)
  }
  const cutoff = Date.now() - days * 86400000
  const todo = []
  for (const [day, items] of byDay) {
    if (new Date(`${day}T00:00:00`).getTime() < cutoff) continue
    const body = dayDigest(items)
    if (body.length < 40) continue
    const h = hashOf(body)
    if (cards[day]?.hash === h && Array.isArray(cards[day].topics) && cards[day].topics.length) continue
    todo.push({ day, body, hash: h })
  }
  if (!todo.length) return { ok: true, generated: 0, days: [] }

  const done = []
  for (let i = 0; i < todo.length; i++) {
    if (signal?.aborted) break
    const { day, body, hash } = todo[i]
    try {
      const text = await call([{ role: 'user', content: `${PROMPT}\n${body}` }])
      onRaw?.(day, text)
      const topics = parseTopics(text)
      if (topics.length) {
        cards[day] = { model: m || 'dsh-current', generatedAt: new Date().toISOString(), hash, topics }
        done.push(day)
        await saveDayCards(cards)
      }
    } catch (e) {
      const why = `[ERROR] ${e?.message || e}`
      onRaw?.(day, why)
      onProgress?.(i + 1, todo.length, `${day} 失败：${e?.message || e}`)
      continue
    }
    onProgress?.(i + 1, todo.length, day)
  }
  return { ok: true, generated: done.length, days: done }
}

/** 给候选菜单用的「按天看」文本块 */
export function dayMenuText(cards, days = 7, limitDays = 5) {
  const keys = Object.keys(cards || {}).sort().slice(-Math.max(1, limitDays))
  if (!keys.length) return []
  const out = []
  for (const day of keys.reverse()) {
    const topics = cards[day]?.topics || []
    if (!topics.length) continue
    out.push({ day, topics: topics.map((t) => ({ topic: t.topic, summary: t.summary })) })
  }
  return out.slice(0, limitDays)
}
