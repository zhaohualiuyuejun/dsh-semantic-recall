/**
 * lib/vectorstore.mjs —— 索引落盘 / 读回（纯二进制 Float32，不依赖 numpy）
 *
 *   <scope>/index/meta.json    { version, provider, model, dim, count, builtAt, chunks:[...] }
 *   <scope>/index/vectors.f32  小端 Float32，计数 × 维度 紧密排列
 *
 * 二期：按 scope（源 id）分库；不传 scope = 老的单库路径。
 * 缓存按库分开存 —— 这是多库最容易踩的坑（单值缓存会让 A 库读完 B 库读不到）。
 */
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { indexPath, metaPath, vectorsPath } from './paths.mjs'

const VERSION = 1

/** scopeKey → { key, meta, vecs: Float32Array, dim, count } */
const caches = new Map()
const ck = (scope) => (scope ? String(scope) : '')

function vectorsToBuffer(vecs, dim) {
  const buf = Buffer.allocUnsafe(vecs.length * dim * 4)
  let off = 0
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) {
      buf.writeFloatLE(v[i] || 0, off)
      off += 4
    }
  }
  return buf
}

async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export async function saveIndex(meta, vecs, scope = null) {
  const count = Array.isArray(meta.chunks) ? meta.chunks.length : vecs.length
  const dim = vecs[0]?.length || meta.dim || 0
  const m = { ...meta, version: VERSION, count, dim }
  await writeAtomic(vectorsPath(scope), vectorsToBuffer(vecs, dim))
  await writeAtomic(metaPath(scope), Buffer.from(JSON.stringify(m), 'utf8'))
  // 顺手填好内存缓存（避免刚写完又读一遍 50MB 文件）
  const flat = new Float32Array(vecs.length * dim)
  for (let i = 0; i < vecs.length; i++) flat.set(vecs[i], i * dim)
  caches.set(ck(scope), { key: `${m.builtAt}|${count}`, meta: m, vecs: flat, dim, count })
  return m
}

/** 读索引（按库缓存；用两个文件的 mtime 判断是否变化） */
export async function loadIndex(scope = null) {
  let ms
  try { ms = await stat(metaPath(scope)) } catch { return null }
  let vs
  try { vs = await stat(vectorsPath(scope)) } catch { return null }
  const key = `${ms.mtimeMs}|${vs.mtimeMs}|${vs.size}`
  const hit = caches.get(ck(scope))
  if (hit && hit.key === key) return hit

  let meta
  try { meta = JSON.parse(await readFile(metaPath(scope), 'utf8')) } catch { return null }
  if (!meta || !Array.isArray(meta.chunks)) return null

  const dim = Number(meta.dim) || 0
  const count = Array.isArray(meta.chunks) ? meta.chunks.length : 0
  let vecs = new Float32Array(0)
  if (dim > 0 && count > 0) {
    if (vs.size !== count * dim * 4) {
      // 文件与元数据对不上（半写 / 改过）：当作没有索引，让调用方重建
      return null
    }
    const buf = await readFile(vectorsPath(scope))
    vecs = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }
  const c = { key, meta, vecs, dim, count }
  caches.set(ck(scope), c)
  return c
}

/** 清缓存：不传 = 清全部 */
export function clearCache(scope) {
  if (scope === undefined) caches.clear()
  else caches.delete(ck(scope))
}

/** 取第 i 个向量（视图，不复制） */
export function vectorAt(loaded, i) {
  const { vecs, dim } = loaded
  return vecs.subarray(i * dim, (i + 1) * dim)
}

export async function indexStats(scope = null) {
  const loaded = await loadIndex(scope)
  if (!loaded) return { exists: false }
  return {
    exists: true,
    count: loaded.count,
    dim: loaded.dim,
    model: loaded.meta.model,
    provider: loaded.meta.provider,
    builtAt: loaded.meta.builtAt,
    bytes: loaded.count * loaded.dim * 4,
    indexPath: indexPath(scope),
  }
}
