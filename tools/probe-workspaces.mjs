/**
 * tools/probe-workspaces.mjs —— 验证「列出 DSH 所有工作区」这段逻辑（与设置页接口同一套算法）
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sessionsRoot, prettyWorkspace } from '../lib/paths.mjs'

const root = sessionsRoot()
const t0 = Date.now()
const ents = await readdir(root, { withFileTypes: true })
const dirs = ents.filter((d) => d.isDirectory()).map((d) => d.name)

const out = []
for (const dir of dirs) {
  let sessions = 0
  const subs = await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])
  for (const s of subs) {
    if (!s.isDirectory()) continue
    try {
      const st = await stat(join(root, dir, s.name, 'session.v4.jsonl.zstd'))
      if (st.isFile()) sessions++
    } catch { /* 没有 */ }
  }
  out.push({ dir, label: prettyWorkspace(dir), sessions })
}
out.sort((a, b) => b.sessions - a.sessions)
console.log(`工作区 ${out.length} 个，用时 ${Date.now() - t0}ms`)
for (const w of out) console.log(String(w.sessions).padStart(4), w.label)
