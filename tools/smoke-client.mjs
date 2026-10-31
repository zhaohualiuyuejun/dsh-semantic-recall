/**
 * tools/smoke-client.mjs —— 客户端 bundle 冒烟测试（不起浏览器）
 * 目标：client.js 能被 ModuleLoader 解析 → factory 产出 {inject, apply} →
 *       apply 能往 settings.section 注册 → 组件首帧能渲染而不抛错。
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
if (!captured) throw new Error('client.js 没有调用 __ModuleLoader__.load')
if (captured.id !== pkg.name) throw new Error(`id 与包名不一致：client=${captured.id} package=${pkg.name}`)

// 极简 React 替身
const el = (type, props, ...children) => ({ type, props, children })
const React = {
  createElement: el,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
}

const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('意外的 require：' + name)
})
if (typeof mod.apply !== 'function') throw new Error('factory 没返回 apply')
if (!Array.isArray(mod.inject)) throw new Error('factory 没返回 inject')

const registered = []
const slots = {
  inject(name, fn) { if (name !== 'settings.section') throw new Error('注入了错误槽位：' + name); fn() },
  register(def, comp) {
    registered.push({ def, comp })
    return () => {}
  },
}
const ctx = {
  get: (k) => (k === 'slots' ? slots : undefined),
  slots,
  effect: (fn) => { try { fn() } catch { /* 忽略 */ } },
}
mod.apply(ctx)

if (registered.length !== 1) throw new Error('没有注册设置分区')
const { def, comp } = registered[0]
if (def.name !== 'settings.section' || !def.label) throw new Error('注册定义不完整：' + JSON.stringify(def))

const outer = comp()               // () => h(Panel)
if (!outer || typeof outer.type !== 'function') throw new Error('section 组件不是函数组件')
const first = outer.type({ close: () => {} })   // 真渲染一帧（此时 st/cfg 为 null）
if (!first || !first.type) throw new Error('组件首帧没有返回元素')

console.log('✅ client 冒烟通过')
console.log('   槽位:', def.name, '| id:', def.id, '| label:', def.label, '| order:', def.order)
console.log('   首帧:', first.type, '| 文案:', JSON.stringify((first.children || []).map((c) => c && c.children ? c.children.join('') : c).join(' ')).slice(0, 80))
