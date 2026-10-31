import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encodeWorkspaceDir, encodeVariants, resolveWorkspaceDir } from '../lib/workspace.mjs'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const root = join(home, 'sessions')
const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

let ok = 0, bad = 0
console.log('--- 1. 已知真实路径 → 目录名 ---')
const known = {
  'H:\\deepseek\\zefeila': '--H-deepseek-zefeila--',
  'H:\\deepseek\\fanfan': '--H-deepseek-fanfan--',
  'H:\\九洲仙魔录': '--H-~4E5D~6D32~4ED9~9B54~5F55--',
  'I:\\九洲仙魔录': '--I-~4E5D~6D32~4ED9~9B54~5F55--',
  'C:\\Users\\ASUS\\.dsh\\dsh_wechat': '--C-Users-ASUS-.dsh-dsh_wechat--',
  'C:\\Users\\ASUS\\.dsh\\bili-duty': '--C-Users-ASUS-.dsh-bili-duty--',
}
for (const [p, want] of Object.entries(known)) {
  const got = encodeWorkspaceDir(p)
  const pass = got === want && dirs.includes(want)
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + p + ' -> ' + got)
  pass ? ok++ : bad++
}

console.log('\n--- 2. resolveWorkspaceDir（knownDirs 在册才认） ---')
const cases = [
  ['H:\\deepseek\\zefeila', '--H-deepseek-zefeila--'],
  ['H:\\deepseek\\zefeila\\plugins\\x', '--H-deepseek-zefeila--'],
  ['H:/deepseek/zefeila', '--H-deepseek-zefeila--'],
  ['H:\\九洲仙魔录', '--H-~4E5D~6D32~4ED9~9B54~5F55--'],
  ['H:\\不存在的目录', null],
]
for (const [p, want] of cases) {
  const got = resolveWorkspaceDir(p, dirs)
  const pass = got === want
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + p + ' -> ' + got + (pass ? '' : ' (want ' + want + ')'))
  pass ? ok++ : bad++
}

console.log('\n--- 3. 无 knownDirs 时兜底 ---')
const fb = resolveWorkspaceDir('H:\\deepseek\\zefeila', null)
console.log((fb === '--H-deepseek-zefeila--' ? 'OK  ' : 'FAIL') + ' fallback -> ' + fb)
fb === '--H-deepseek-zefeila--' ? ok++ : bad++

console.log('\n--- 4. 变体兜底（连字符路径） ---')
const hv = encodeVariants('H:\\my-project')
console.log('variants:', hv)
hv.length === 2 ? ok++ : bad++

console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
