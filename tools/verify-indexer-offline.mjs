/**
 * verify-indexer-offline.mjs —— 一期验收（索引器端到端，离线）
 *
 * 造一个临时 DSH_HOME，只放两个真实会话文件（zefeila / fanfan），
 * 用 provider=none（纯字面，不联网）跑两次 buildIndex：
 *   ① 不设源   → 两个工作区都应进索引
 *   ② 设源=Z   → fanfan 的块必须被剔除，只剩 zefeila
 * 全程不碰真配置、不消耗嵌入额度。
 */
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'

const Z = '--H-deepseek-zefeila--'
const F = '--H-deepseek-fanfan--'
const realHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const realSessions = join(realHome, 'sessions')

/** 在某个工作区下挑一个「足够大、有对话内容」的最小会话文件 */
function pickSmallest(ws) {
  const dir = join(realSessions, ws)
  let best = null
  for (const sid of readdirSync(dir)) {
    const p = join(dir, sid, 'session.v4.jsonl.zstd')
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size < 2000) continue
      if (!best || st.size < best.size) best = { size: st.size, sid, p }
    } catch { /* 跳过 */ }
  }
  return best
}

const zPick = pickSmallest(Z)
const fPick = pickSmallest(F)
if (!zPick || !fPick) {
  console.error('找不到可用的会话文件，跳过离线验收')
  process.exit(2)
}
console.log('样本：zefeila ' + zPick.sid.slice(0, 8) + ' (' + zPick.size + 'B) · fanfan ' + fPick.sid.slice(0, 8) + ' (' + fPick.size + 'B)')

const tmp = mkdtempSync(join(tmpdir(), 'sr-index-'))
for (const [ws, pick] of [[Z, zPick], [F, fPick]]) {
  const d = join(tmp, 'sessions', ws, pick.sid)
  mkdirSync(d, { recursive: true })
  copyFileSync(pick.p, join(d, 'session.v4.jsonl.zstd'))
}

process.env.DSH_HOME = tmp
const { buildIndex } = await import('../lib/indexer.mjs')

let ok = 0, bad = 0
const t = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('OK   ' + name) }
  else { bad++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) }
}

const cfg = { provider: 'none', indexDays: 365, excludeWorkspaces: '', model: '', indexDays2: 0 }

console.log('\n=== ① 不设源：两个工作区都进 ===')
const r1 = await buildIndex({ cfg, force: true })
const m1 = JSON.parse(readFileSync(join(tmp, 'session-recall', 'index', 'meta.json'), 'utf8'))
const ws1 = new Set(m1.chunks.map((c) => c.ws))
t('第一次构建成功', r1.ok === true, JSON.stringify(r1))
t('含 zefeila', ws1.has(Z))
t('含 fanfan', ws1.has(F))
t('meta.wsAllow = null（不限制）', m1.wsAllow === null, String(m1.wsAllow))

console.log('\n=== ② 设源=Z：fanfan 旧块必须被剔除 ===')
const r2 = await buildIndex({ cfg, wsAllow: [Z] })
const m2 = JSON.parse(readFileSync(join(tmp, 'session-recall', 'index', 'meta.json'), 'utf8'))
const ws2 = new Set(m2.chunks.map((c) => c.ws))
t('第二次构建成功', r2.ok === true, JSON.stringify(r2))
t('只剩 zefeila', ws2.size === 1 && ws2.has(Z), [...ws2].join(','))
t('fanfan 块数 = 0', m2.chunks.filter((c) => c.ws === F).length === 0)
t('meta.wsAllow 记录正确', Array.isArray(m2.wsAllow) && m2.wsAllow.length === 1 && m2.wsAllow[0] === Z, JSON.stringify(m2.wsAllow))
t('不需要重新嵌入（新增 0）', r2.added === 0, String(r2.added))

console.log('\n=== ③ 移除源：回到全量 ===')
const r3 = await buildIndex({ cfg, wsAllow: null })
const m3 = JSON.parse(readFileSync(join(tmp, 'session-recall', 'index', 'meta.json'), 'utf8'))
const ws3 = new Set(m3.chunks.map((c) => c.ws))
t('第三次构建成功', r3.ok === true)
t('fanfan 重新进入索引', ws3.has(F) && ws3.has(Z), [...ws3].join(','))
t('meta.wsAllow 回到 null', m3.wsAllow === null)

console.log('\n=== ④ 有源时旧「排除清单」不得再拦 ===')
const r4 = await buildIndex({ cfg: { ...cfg, excludeWorkspaces: 'fanfan' }, wsAllow: [Z, F] })
const m4 = JSON.parse(readFileSync(join(tmp, 'session-recall', 'index', 'meta.json'), 'utf8'))
const ws4 = new Set(m4.chunks.map((c) => c.ws))
t('第四次构建成功', r4.ok === true)
t('fanfan 勾进源后必须索引（旧排除清单不参与）', ws4.has(F) && ws4.has(Z), [...ws4].join(','))

console.log('\n=== ⑤ 多库分源（scopes/<id>，二期核心）===')
const rA = await buildIndex({ cfg, wsAllow: [Z], scope: 'a' })
const mA = JSON.parse(readFileSync(join(tmp, 'session-recall', 'scopes', 'a', 'index', 'meta.json'), 'utf8'))
const rB = await buildIndex({ cfg, wsAllow: [F], scope: 'b' })
const mB = JSON.parse(readFileSync(join(tmp, 'session-recall', 'scopes', 'b', 'index', 'meta.json'), 'utf8'))
const wsA = new Set(mA.chunks.map((c) => c.ws))
const wsB = new Set(mB.chunks.map((c) => c.ws))
t('A 库建成', rA.ok === true && rA.total > 0, JSON.stringify(rA))
t('A 库只有 zefeila', wsA.size === 1 && wsA.has(Z), [...wsA].join(','))
t('B 库建成', rB.ok === true && rB.total > 0, JSON.stringify(rB))
t('B 库只有 fanfan', wsB.size === 1 && wsB.has(F), [...wsB].join(','))
t('A 库 meta.scope = a', mA.scope === 'a')
t('B 库 meta.scope = b', mB.scope === 'b')
t('两库各自有块（互不覆盖）', mA.chunks.length > 0 && mB.chunks.length > 0)
t('旧单库仍在（可作为回退）', readFileSync(join(tmp, 'session-recall', 'index', 'meta.json'), 'utf8').length > 0)

rmSync(tmp, { recursive: true, force: true })
console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
