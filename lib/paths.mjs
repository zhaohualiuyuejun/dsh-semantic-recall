/**
 * lib/paths.mjs —— 所有落盘位置集中在这里（绝不要写回 DSH 的 sessions 目录）
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

export function indexPath() { return join(stateDir(), 'index') }
export function metaPath() { return join(indexPath(), 'meta.json') }
export function vectorsPath() { return join(indexPath(), 'vectors.f32') }
export function daysPath() { return join(stateDir(), 'days.json') }
export function statePath() { return join(stateDir(), 'state.json') }
export function logPath() { return join(stateDir(), 'build.log') }

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
