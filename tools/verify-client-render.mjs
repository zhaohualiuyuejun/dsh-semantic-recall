/**
 * verify-client-render.mjs —— 客户端「有数据帧」渲染验证（二期：多源）
 * 喂两个源的假数据，确认：源下拉可切换、当前源列表、外源行置灰、添加/移除按钮都在。
 */
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
let captured = null
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '', style: {} }),
  head: { appendChild() {} },
}
await import('../client.js')

const el = (type, props, ...children) => ({ type, props: props || {}, children })
const Z = '--H-deepseek-zefeila--'
const W = '--C-Users-ASUS-.dsh-dsh_wechat--'
const F = '--H-deepseek-fanfan--'
const B = '--C-Users-ASUS-.dsh-bili-duty--'

const status = {
  enabled: true, provider: 'cloud', providerEffective: 'cloud', degraded: null, model: '(默认)',
  indexDays: 7, excludeWorkspaces: '(无)',
  sources: [
    {
      id: 'src1', name: '泽菲拉', workspaces: [Z, W], workspacesPretty: ['H:\\deepseek\\zefeila', 'C:\\Users\\ASUS\\.dsh\\dsh_wechat'],
      index: { chunks: 2810, dim: 4096, sizeMB: 43.9, builtAt: '2026-10-31T12:00:00Z', path: 'C:/Users/ASUS/.dsh/session-recall/scopes/src1/index' },
      coverageDays: 21, perDayChunks: 134, dayCards: 2, building: false, lastBuild: { phase: 'idle' },
    },
    {
      id: 'src2', name: '饭饭', workspaces: [F], workspacesPretty: ['H:\\deepseek\\fanfan'],
      index: null, dayCards: 0, building: false, lastBuild: { phase: 'idle' },
    },
  ],
  source: { id: 'src1', name: '泽菲拉', workspaces: [Z, W], workspacesPretty: ['H:\\deepseek\\zefeila', 'C:\\Users\\ASUS\\.dsh\\dsh_wechat'] },
  index: { chunks: 2760, dim: 4096, sizeMB: 43.1, builtAt: '2026-10-31T12:00:00Z', path: 'x' },
  building: false, lastBuild: { phase: 'idle' }, dayCards: 2, llm: {},
  stateDir: 'x', configPath: 'x', pageApi: true,
}
const config = {
  enabled: true, provider: 'cloud', apiBase: '', localBase: '', model: '', indexDays: 7,
  excludeWorkspaces: '', allowFromWorkspaces: '',
  sources: [
    { id: 'src1', name: '泽菲拉', workspaces: [Z, W] },
    { id: 'src2', name: '饭饭', workspaces: [F] },
  ],
  daySummaries: true, summaryModel: '', autoIndex: true, apiKeySet: true,
}
const workspaces = [
  { dir: Z, label: 'H:\\deepseek\\zefeila', sessions: 47, chunks: 2735, excluded: false, indexed: true, assignedTo: 'src1', inSource: true },
  { dir: W, label: 'C:\\Users\\ASUS\\.dsh\\dsh_wechat', sessions: 1, chunks: 25, excluded: false, indexed: true, assignedTo: 'src1', inSource: true },
  { dir: F, label: 'H:\\deepseek\\fanfan', sessions: 3, chunks: 0, excluded: true, indexed: false, assignedTo: 'src2', inSource: false },
  { dir: B, label: 'C:\\Users\\ASUS\\.dsh\\bili-duty', sessions: 2, chunks: 0, excluded: true, indexed: false, assignedTo: null, inSource: false },
]

// Panel 里 useState 调用顺序：st, cfg, ws, key, msg, busy, curId, nameDraft, ollama
const seq = [status, config, workspaces, '', null, false, '', null, null]
const React = {
  createElement: el,
  useState: (init) => [seq.length ? seq.shift() : (typeof init === 'function' ? init() : init), () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
}

const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('意外的 require：' + name)
})
const registered = []
const slots = {
  inject(name, fn) { if (name !== 'settings.section') throw new Error('槽位错'); fn() },
  register(def, comp) { registered.push({ def, comp }); return () => {} },
}
mod.apply({ get: (k) => (k === 'slots' ? slots : undefined), slots, effect: (fn) => fn() })

const tree = registered[0].comp().type({ close: () => {} })

function texts(node, out = []) {
  if (node == null || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) texts(c, out); return out }
  if (node.children) for (const c of node.children) texts(c, out)
  return out
}
const all = texts(tree).join(' | ')

let ok = 0, bad = 0
const t = (name, cond) => { if (cond) { ok++; console.log('OK   ' + name) } else { bad++; console.log('FAIL ' + name) } }

t('渲染出「源工作区」区块', all.includes('源工作区'))
t('默认选中第一个源「泽菲拉」', all.includes('泽菲拉'))
t('下拉里有第二个源「饭饭」', all.includes('饭饭'))
t('显示当前源包含的工作区数', all.includes('包含 2 个工作区'))
t('有「＋ 添加源工作区」', all.includes('添加源工作区'))
t('有「移除当前源」', all.includes('移除当前源'))
t('外源的工作区显示占用提示', all.includes('已被「饭饭」占用'))
t('列表标题为「本源包含的工作区」', all.includes('本源包含的工作区'))
t('状态卡片显示当前源块数 2810', all.includes('2810'))
t('提示源之间互斥', all.includes('一个工作区只能归一个源'))
t('「接口地址」提示为一般不用填', all.includes('一般不用填'))

function findPlaceholder(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) findPlaceholder(c, out); return out }
  if (node.type === 'input' && node.props && typeof node.props.placeholder === 'string') out.push(node.props.placeholder)
  if (node.children) for (const c of node.children) findPlaceholder(c, out)
  return out
}
t('接口地址 placeholder 说明留空即可', findPlaceholder(tree).some((p) => p.includes('一般留空即可')))

// 源名输入框：value 必须来自已保存的名字（草稿为 null 时）
function findInput(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) findInput(c, out); return out }
  if (node.type === 'input' && node.props && node.props.value === '泽菲拉') out.push(node)
  if (node.children) for (const c of node.children) findInput(c, out)
  return out
}
t('源名输入框显示已保存的名字', findInput(tree).length >= 1)
t('话题卡有「检测 Ollama」按钮', all.includes('检测 Ollama'))
t('话题卡说明区分「对话模型」与嵌入模型', all.includes('不是上方「本地」那个嵌入模型'))
t('对话模型 placeholder 给出例子', findPlaceholder(tree).some((p) => p.includes('qwen3:8b')))
t('索引天数有体积预估', all.includes('日均 134 块') && all.includes('估算'))
t('显示索引文件位置', all.includes('索引文件：') && all.includes('scopes/src1'))

console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
