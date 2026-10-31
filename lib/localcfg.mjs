/**
 * lib/localcfg.mjs —— 插件自己的配置文件（**权威来源**）
 *
 * 为什么不用 DSH 自带设置页：本机 DSH 0.2.1-rc.5 上 ctx.settings.update() 返回成功但**不落盘**
 * （同一个坑 dsh-bili-scroll 也踩过：profile reload requires the root Include entry）。
 * ⇒ 设置页只当展示；真正生效的是 $DSH_HOME/session-recall/config.json（本文件）。
 *
 * 层级：默认值 < 插件 row 的 config（patch） < config.json < 设置页 user 层（若哪天真的生效）
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateDir } from './paths.mjs'

export function configPath() {
  return join(stateDir(), 'config.json')
}

let cache = { at: 0, value: {} }

/** 首跑时把配置文件铺出来：新手才有东西可改（否则要自己去猜路径、自己建文件） */
export async function ensureLocalConfig(defaults) {
  try {
    await readFile(configPath(), 'utf8')
    return false // 已存在，绝不覆盖用户改过的值
  } catch { /* 不存在 → 铺一份模板 */ }
  return writeLocalConfig({
    _说明: '把硅基流动的 Key 填到 apiKey（sk- 开头）；provider 可选 siliconflow / ollama / none',
    ...defaults,
    apiKey: '',
  })
}

export async function readLocalConfig() {
  if (Date.now() - cache.at < 1500) return cache.value
  try {
    const v = JSON.parse(await readFile(configPath(), 'utf8'))
    cache = { at: Date.now(), value: v && typeof v === 'object' ? v : {} }
  } catch {
    cache = { at: Date.now(), value: {} }
  }
  return cache.value
}

export async function writeLocalConfig(patch) {
  const cur = await readLocalConfig()
  const next = { ...cur, ...patch }
  await mkdir(stateDir(), { recursive: true })
  const tmp = `${configPath()}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await rename(tmp, configPath())
  cache = { at: Date.now(), value: next }
  return next
}

/** 同步读：给 liveCfg 用（配置很小，读一次几毫秒；带 1.5s 缓存） */
export function readLocalConfigSync() {
  if (Date.now() - cache.at < 1500) return cache.value
  try {
    const v = JSON.parse(readFileSync(configPath(), 'utf8'))
    cache = { at: Date.now(), value: v && typeof v === 'object' ? v : {} }
  } catch {
    cache = { at: Date.now(), value: {} }
  }
  return cache.value
}
