/**
 * lib/vectorstore.mjs —— 索引落盘 / 读回（纯二进制 Float32，不依赖 numpy）
 *
 *   index/meta.json    { version, provider, model, dim, count, builtAt, chunks:[...] }
 *   index/vectors.f32  小端 Float32，计数 × 维度 紧密排列
 */
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { indexPath, metaPath, vectorsPath } from './paths.mjs'

const VERSION = 1

let cache = null // { key, meta, vecs: Float32Array, dim, count }

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

export async function saveIndex(meta, vecs) {
  const count = Array.isArray(meta.chunks) ? meta.chunks.length : vecs.length
  const dim = vecs[0]?.length || meta.dim || 0
  const m = { ...meta, version: VERSION, count, dim }
  await writeAtomic(vectorsPath(), vectorsToBuffer(vecs, dim))
  await writeAtomic(metaPath(), Buffer.from(JSON.stringify(m), 'utf8'))
  // 顺手填好内存缓存（避免刚写完又读一遍 50MB 文件）
  const flat = new Float32Array(vecs.length * dim)
  for (let i = 0; i < vecs.length; i++) flat.set(vecs[i], i * dim)
  cache = { key: `${m.builtAt}|${count}`, meta: m, vecs: flat, dim, count }
  return m
}

/** 读索引（带缓存：按两个文件的 mtime 判断是否变化） */
export async function loadIndex() {
  let ms
  try { ms = await stat(metaPath()) } catch { return null }
  let vs
  try { vs = await stat(vectorsPath()) } catch { return null }
  const key = `${ms.mtimeMs}|${vs.mtimeMs}|${vs.size}`
  if (cache && cache.key === key) return cache

  let meta
  try { meta = JSON.parse(await readFile(metaPath(), 'utf8')) } catch { return null }
  if (!meta || !Array.isArray(meta.chunks)) return null

  const dim = Number(meta.dim) || 0
  const count = Array.isArray(meta.chunks) ? meta.chunks.length : 0
  let vecs = new Float32Array(0)
  if (dim > 0 && count > 0) {
    if (vs.size !== count * dim * 4) {
      // 文件与元数据对不上（半写 / 改过）：当作没有索引，让调用方重建
      return null
    }
    const buf = await readFile(vectorsPath())
    vecs = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }
  cache = { key, meta, vecs, dim, count }
  return cache
}

export function clearCache() { cache = null }

/** 取第 i 个向量（视图，不复制） */
export function vectorAt(loaded, i) {
  const { vecs, dim } = loaded
  return vecs.subarray(i * dim, (i + 1) * dim)
}

export async function indexStats() {
  const loaded = await loadIndex()
  if (!loaded) return { exists: false }
  return {
    exists: true,
    count: loaded.count,
    dim: loaded.dim,
    model: loaded.meta.model,
    provider: loaded.meta.provider,
    builtAt: loaded.meta.builtAt,
    bytes: loaded.count * loaded.dim * 4,
    indexPath: indexPath(),
  }
}
