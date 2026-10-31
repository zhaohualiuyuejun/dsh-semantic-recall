/**
 * lib/extract.mjs —— 从 DSH 会话文件里抽出「人话」
 *
 * 输入：`<sessions>/<工作区>/<会话>/session.v4.jsonl.zstd`（逐帧 zstd，多帧拼接）
 * 输出：[{ session, ws, wsPretty, t, role, text }]
 *
 * 只留 user / assistant 的 text；跳过 reasoning、tool-call、工具输出与系统注入。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { prettyWorkspace } from './paths.mjs'

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** 系统注入 / 运行时上下文：这些不是「我们说过的话」，索引里必须滤掉 */
const SYS_PREFIX = [
  'Current runtime context', 'Current DSH file policy', '<system-reminder>',
  'Current time:', 'Time sampled', '本次执行由任务看板', '标签提示（任务看板标签',
  '本次执行由任务看板的单次定时自动触发', 'You are the Team Lead named',
  'A browser bridge may be connected', '<available_skills>',
  'This snapshot supersedes earlier runtime-context snapshots', 'You are repeating',
  'background job', 'The user chose',
  // 自动化会话（B站值守 / 定时任务）把整段人设当用户消息发进来 —— 不是「我们说过的话」
  '你是这个账号的', '===== 使用者', 'This is an automated run',
  // 跨通道桥接的渠道注入
  '[渠道：',
  // QQ/微信等桥接的人设与节奏注入（不是「说过的话」）
  '【当前时间】', '【当前角色】', '【首回复节奏】', '【本轮记忆】', '【使用说明】', '【最近的消息】',
]

/**
 * 桥接类插件（QQ / 微信 / Telegram）的真实对话藏在工具里：
 *   · 发出去的 → tool/call 的 arguments.messages
 *   · 收到的   → tool/result 的 messages[].text
 * 这两类工具名按常见命名匹配；不匹配时行为与以前完全一致。
 */
const SEND_TOOL_RE = /send_(?:private_|group_)?message|send_burst|reply_message/i
const RECV_TOOL_RE = /get_unread_messages|recent_messages|get_group_history|fetch_messages/i

const parseMaybeJson = (v) => {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!s || (s[0] !== '{' && s[0] !== '[')) return v
  try { return JSON.parse(s) } catch { return v }
}

/** 把 string / 数组 / 对象统一成文本数组 */
function toTextList(v) {
  if (v == null) return []
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(toTextList)
  if (typeof v === 'object') {
    const t = v.text ?? v.content ?? v.message ?? v.body
    return typeof t === 'string' ? [t] : []
  }
  return []
}

function isSys(text) {
  const s = text.trimStart()
  return SYS_PREFIX.some((p) => s.startsWith(p))
}

/** 逐帧解压：扫 magic，每一帧单独解（最后半帧可能还没写完，解失败就丢） */
export function unzstd(buf) {
  const pos = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) pos.push(i)
  }
  const parts = []
  for (let k = 0; k < pos.length; k++) {
    const s = pos[k]
    const e = k + 1 < pos.length ? pos[k + 1] : buf.length
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(s, e))) } catch { /* 半帧，跳过 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

function textsOf(o) {
  const arr = (o.data && o.data.content) || (o.data && o.data.message && o.data.message.content) || []
  const out = []
  for (const it of arr) {
    if (it && it.type === 'text' && typeof it.text === 'string') out.push(it.text)
  }
  return out
}

/**
 * 找近 N 天有更新的会话文件。
 * @param {object} opts { root, days, wsFilter?: (dirName)=>boolean }
 */
export async function listSessionFiles({ root, days, wsFilter }) {
  const now = Date.now()
  const files = []
  let workspaces = []
  try { workspaces = await readdir(root) } catch { return { files, workspaces: [] } }

  for (const ws of workspaces) {
    if (wsFilter && !wsFilter(ws)) continue
    const wsDir = join(root, ws)
    let sessions = []
    try {
      const st = await stat(wsDir)
      if (!st.isDirectory()) continue
      sessions = await readdir(wsDir)
    } catch { continue }
    for (const sid of sessions) {
      const p = join(wsDir, sid, 'session.v4.jsonl.zstd')
      try {
        const st = await stat(p)
        if (!st.isFile()) continue
        if (now - st.mtimeMs > days * 86400000) continue
        files.push({ path: p, session: sid, ws, mtimeMs: st.mtimeMs })
      } catch { /* 没有这个文件就算了 */ }
    }
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  return { files, workspaces }
}

/**
 * 抽取人话。onProgress 每处理完一个会话回调一次（percent, label）。
 * 每读一个文件 yield 一次事件循环，避免长时间卡住宿主。
 */
export async function extractSessions({ root, days, wsFilter, onProgress, signal } = {}) {
  const { files } = await listSessionFiles({ root, days, wsFilter })
  const recs = []
  let i = 0
  for (const f of files) {
    if (signal?.aborted) break
    i++
    let text = ''
    try { text = unzstd(await readFile(f.path)) } catch { continue }
    const wsPretty = prettyWorkspace(f.ws)
    /** 本次会话里 callId → 工具名（把 tool/result 关联回工具） */
    const callName = new Map()
    for (const ln of text.split('\n')) {
      if (!ln) continue
      if (
        !ln.includes('"type":"user/message"') &&
        !ln.includes('"type":"assistant/message"') &&
        !ln.includes('"type":"tool/call"') &&
        !ln.includes('"type":"tool/result"')
      ) continue
      let o
      try { o = JSON.parse(ln) } catch { continue }

      /** 统一落盘：长度、系统注入、锚点都在这里处理 */
      const push = (role, body, extra = {}) => {
        let b = String(body || '').trim()
        if (!b || b.length < 8) return
        if (role === 'user' && isSys(b)) return
        if (b.length > 20000) b = b.slice(0, 20000)
        recs.push({
          session: f.session,
          ws: f.ws,
          wsPretty,
          t: Number(extra.t ?? o.time) || 0,
          role,
          text: b,
          seq: extra.seq !== undefined ? extra.seq : (Number.isFinite(Number(o.seq)) ? Number(o.seq) : null),
          msgId: extra.msgId ?? null,
          fromTool: Boolean(extra.fromTool),
        })
      }

      // ── 桥接发送：真实回复在 tool/call 的 arguments 里
      if (o.type === 'tool/call') {
        const toolName = String(o.data?.name || '')
        const cid = o.data?.callId
        if (cid) callName.set(cid, toolName)
        if (SEND_TOOL_RE.test(toolName)) {
          const args = parseMaybeJson(o.data?.arguments)
          const raw = args?.messages ?? args?.message ?? args?.text ?? args?.content
          for (const body of toTextList(raw)) push('assistant', body, { fromTool: true, msgId: cid || null })
        }
        continue
      }

      // ── 桥接接收：真实用户消息在 tool/result 的 messages[] 里
      if (o.type === 'tool/result') {
        const cid = o.data?.message?.source?.callId || o.data?.message?.toolCallId
        const toolName = callName.get(cid) || ''
        if (RECV_TOOL_RE.test(toolName)) {
          const content = o.data?.message?.content || []
          const raw = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n')
          const parsed = parseMaybeJson(raw)
          const msgs = parsed?.messages || parsed?.newMessages || parsed?.data?.messages
          if (Array.isArray(msgs)) {
            for (const m of msgs) {
              const body = String(m?.text || m?.content || '').trim()
              if (!body) continue
              push('user', body, {
                fromTool: true,
                t: Number(m?.time) || Number(o.time) || 0,
                seq: Number.isFinite(Number(m?.seq)) ? Number(m.seq) : null,
                msgId: m?.messageId || null,
              })
            }
          }
        }
        continue
      }

      // ── 普通会话消息（原逻辑）
      const role = o.type === 'user/message' ? 'user' : 'assistant'
      const texts = textsOf(o)
      if (!texts.length) continue
      push(role, texts.join('\n'), {
        msgId: (o.data && (o.data.id || o.data.messageId || (o.data.message && o.data.message.id))) || null,
      })
    }
    onProgress?.(i / files.length, `${wsPretty} / ${f.session.slice(0, 8)}`)
    await new Promise((r) => setImmediate(r))
  }
  recs.sort((a, b) => a.t - b.t)
  // 同一条话只留一条：工具提取出来的记录与已有记录重复时跳过
  const seen = new Set()
  const out = []
  for (const r of recs) {
    const k = `${r.session}|${r.role}|${String(r.text).slice(0, 120)}`
    if (r.fromTool && seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return { recs: out, fileCount: files.length }
}
