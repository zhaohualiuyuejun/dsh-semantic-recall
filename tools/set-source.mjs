/**
 * set-source.mjs —— 设置一期「源工作区」（走设置页同款 HTTP 接口）
 * 用法: node tools/set-source.mjs
 *       node tools/set-source.mjs --clear
 * 源名固定写在本文件里（避免 shell 传中文时编码走样）。
 */
const API = 'http://127.0.0.1:19387/api/session-recall'
const NAME = '泽菲拉'
const WORKSPACES = ['--H-deepseek-zefeila--', '--C-Users-ASUS-.dsh-dsh_wechat--']

const clear = process.argv.includes('--clear')
const sources = clear ? '' : JSON.stringify([{ id: 'src1', name: NAME, workspaces: WORKSPACES }])

const res = await fetch(`${API}/config`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:19387' },
  body: JSON.stringify({ patch: { sources } }),
})
const j = await res.json()
console.log(JSON.stringify({ ok: j.ok, rebuild: j.rebuild, sources: j.config?.sources, chunks: j.status?.index?.chunks }, null, 1))
