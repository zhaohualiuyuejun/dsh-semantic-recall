/**
 * verify-policy.mjs —— 二期验收（策略层）
 * 覆盖：多源解析（互斥、空源保留）、白名单过滤器、调用方路由、配置往返。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSources, makeWsFilter, routeCaller, workspaceOwners, findSourceForWorkspace } from '../lib/policy.mjs'

let ok = 0, bad = 0
const t = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('OK   ' + name) }
  else { bad++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) }
}

const Z = '--H-deepseek-zefeila--'
const F = '--H-deepseek-fanfan--'
const W = '--C-Users-ASUS-.dsh-dsh_wechat--'
const B = '--C-Users-ASUS-.dsh-bili-duty--'

console.log('=== 1. parseSources（多源 + 互斥 + 空源）===')
t('空串 → 空数组', parseSources('').length === 0)
t('非法 JSON → 空数组', parseSources('{oops').length === 0)
t('非数组 → 空数组', parseSources('{"a":1}').length === 0)
t('空源保留（新建还没勾）', parseSources('[{"id":"a","name":"A","workspaces":[]}]').length === 1)
t('正常解析', parseSources(JSON.stringify([{ id: 's1', name: '泽菲拉', workspaces: [Z, W] }]))[0].workspaces.length === 2)
t('缺 id/name 有兜底', parseSources(JSON.stringify([{ id: 'x', workspaces: [Z] }]))[0].name.length > 0)
const excl = parseSources(JSON.stringify([
  { id: 'a', name: 'A', workspaces: [Z] },
  { id: 'b', name: 'B', workspaces: [Z, F] },
]))
t('互斥：后源不能抢已归属的工作区', excl[0].workspaces.length === 1 && excl[1].workspaces.length === 1 && excl[1].workspaces[0] === F,
  JSON.stringify(excl.map((s) => s.workspaces)))
t('同一源内可含多个工作区', parseSources(JSON.stringify([{ id: 'a', workspaces: [Z, F, W, B] }]))[0].workspaces.length === 4)

console.log('\n=== 2. makeWsFilter ===')
t('无源 → 不限制', makeWsFilter(null, '').active === false && makeWsFilter(null, '').ok(F))
t('空源 → 全挡（有源但没勾）', !makeWsFilter([], '').ok(Z), 'active=' + makeWsFilter([], '').active)
t('有源：源内留', makeWsFilter([Z], '').ok(Z))
t('有源：源外挡', !makeWsFilter([Z], '').ok(F))
t('有源时旧排除清单不参与（勾了就能索引）', makeWsFilter([B], 'bili-duty').ok(B))
t('无源时排除清单仍生效', !makeWsFilter(null, 'bili-duty').ok(B))
t('源内含多个工作区', makeWsFilter([Z, F], '').ok(Z) && makeWsFilter([Z, F], '').ok(F))

console.log('\n=== 3. 路由（调用方去哪个库）===')
const srcs = parseSources(JSON.stringify([
  { id: 'a', name: '泽菲拉', workspaces: [Z, W] },
  { id: 'b', name: '饭饭', workspaces: [F] },
]))
t('zefeila → 源 a', routeCaller(Z, srcs)?.scope === 'a')
t('wechat → 源 a（同一源多入口）', routeCaller(W, srcs)?.scope === 'a')
t('fanfan → 源 b', routeCaller(F, srcs)?.scope === 'b')
t('bili-duty → 不属于任何源', routeCaller(B, srcs) === null)
t('定位不到工作区 → null', routeCaller(null, srcs) === null)
t('findSourceForWorkspace 一致', findSourceForWorkspace(F, srcs)?.id === 'b')

console.log('\n=== 4. 归属表 ===')
const owners = workspaceOwners(srcs)
t('zefeila 归 a', owners.get(Z) === 'a')
t('fanfan 归 b', owners.get(F) === 'b')
t('未归属的查不到', owners.get(B) === undefined)

console.log('\n=== 5. config.json 往返（临时 DSH_HOME，不碰真配置）===')
const tmp = mkdtempSync(join(tmpdir(), 'sr-verify-'))
process.env.DSH_HOME = tmp
const lc = await import('../lib/localcfg.mjs')
await lc.ensureLocalConfig({ sources: '', enabled: true })
const payload = JSON.stringify([{ id: 'a', name: '泽菲拉', workspaces: [Z, W] }, { id: 'b', name: '饭饭', workspaces: [F] }])
await lc.writeLocalConfig({ sources: payload })
const back = lc.readLocalConfigSync()
t('多源写入后能读回', back.sources === payload)
t('读回后解析成 2 档', parseSources(back.sources).length === 2)
rmSync(tmp, { recursive: true, force: true })

console.log('\n结果: OK=' + ok + ' FAIL=' + bad)
process.exit(bad ? 1 : 0)
