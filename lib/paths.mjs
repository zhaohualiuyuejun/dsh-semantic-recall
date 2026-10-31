/**
 * lib/paths.mjs —— 所有落盘位置集中在这里（绝不要写回 DSH 的 sessions 目录）
 *
 * 二期：支持多库（每个源一个库）。
 *   · 不传 scope（无源 / 老用户）→ 沿用旧布局：$DSH_HOME/session-recall/index/
 *   · 传 scope（源 id）        → $DSH_HOME/session-recall/scopes/<scope>/index/
 * 这样「移除所有源」能立刻回到旧库，不需要重建。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** DSH 的家：优先用宿主给的环境变量，退到 ~/.dsh */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 会话历史根目录（只读） */
export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/** 本插件自己的数据目录 */
export function stateDir() {
  return join(dshHome(), 'session-recall')
}

/** 源 id → 安全目录名（只留字母数字._-，避免路径穿越） */
export function safeScopeKey(id) {
  const s = String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)
  return s || 'default'
}

/** 源的数据目录；无 scope = 插件根（老布局） */
export function scopeDir(scope) {
  return scope ? join(stateDir(), 'scopes', safeScopeKey(scope)) : stateDir()
}

export function indexPath(scope) { return join(scopeDir(scope), 'index') }
export function metaPath(scope) { return join(indexPath(scope), 'meta.json') }
export function vectorsPath(scope) { return join(indexPath(scope), 'vectors.f32') }
export function daysPath(scope) { return join(scopeDir(scope), 'days.json') }
export function statePath(scope) { return join(scopeDir(scope), 'state.json') }
export function logPath(scope) { return join(scopeDir(scope), 'build.log') }

/**
 * 工作区目录名 → 给人看的路径。
 *   --D-projects-demo--  → D:\projects\demo
 *   --D-~4E2D~6587-- → D:\中文（~XXXX 是 UTF-16 码点转义）
 */
export function prettyWorkspace(dirName) {
  let s = String(dirName || '')
  s = s.replace(/^--+/, '').replace(/-+$/, '')
  s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const m = /^([A-Za-z])-(.*)$/.exec(s)
  if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/-/g, '\\')}`
  return s.replace(/-/g, '\\')
}
