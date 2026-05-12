import type { AppDatabase } from '../db.js'
import { KeyPoolRepository } from './key-pool.js'

type KeyManagerExport = {
  keys?: unknown
  unscoped_keys?: unknown
  mixed_buckets?: unknown
}

export async function syncFromKeyManager(db: AppDatabase, baseUrl = process.env.KEY_MANAGER_URL) {
  if (!baseUrl) {
    return { synced: false, imported: 0, warning: 'KEY_MANAGER_URL 未設定。' }
  }

  const url = new URL('/api/keys/export', baseUrl)
  url.searchParams.set('trusted_only', '1')
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    throw new Error(`key-manager sync failed: HTTP ${response.status}`)
  }

  const payload = await response.json() as KeyManagerExport
  const rawKeys = Array.isArray(payload.keys) ? payload.keys : []
  const keys = rawKeys.filter((key): key is string => typeof key === 'string')
  const result = new KeyPoolRepository(db).replaceFromKeyManager(keys)
  const warnings: string[] = []
  if (Number(payload.unscoped_keys ?? 0) > 0) warnings.push('key-manager 回報 unscoped_keys > 0')
  if (Number(payload.mixed_buckets ?? 0) > 0) warnings.push('key-manager 回報 mixed_buckets > 0')

  return { synced: true, ...result, warning: warnings.join('；') || null }
}
