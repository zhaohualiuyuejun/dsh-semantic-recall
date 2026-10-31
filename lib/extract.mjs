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
]

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
    for (const ln of text.split('\n')) {
      if (!ln) continue
      if (!ln.includes('"type":"user/message"') && !ln.includes('"type":"assistant/message"')) continue
      let o
      try { o = JSON.parse(ln) } catch { continue }
      const role = o.type === 'user/message' ? 'user' : 'assistant'
      const texts = textsOf(o)
      if (!texts.length) continue
      let body = texts.join('\n').trim()
      if (!body || body.length < 8) continue
      if (role === 'user' && isSys(body)) continue
      if (body.length > 20000) body = body.slice(0, 20000)
      recs.push({ session: f.session, ws: f.ws, wsPretty, t: Number(o.time) || 0, role, text: body })
    }
    onProgress?.(i / files.length, `${wsPretty} / ${f.session.slice(0, 8)}`)
    await new Promise((r) => setImmediate(r))
  }
  recs.sort((a, b) => a.t - b.t)
  return { recs, fileCount: files.length }
}
