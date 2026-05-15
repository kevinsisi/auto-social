import { KeyPool, SqliteAdapter, type ApiKey } from '@kevinsisi/ai-core/key-pool'
import type { AppDatabase } from '../db.js'

const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000
const DEFAULT_AUTH_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_LEASE_MS = 5 * 60 * 1000

export type KeyHealth = 'available' | 'cooldown' | 'leased' | 'inactive'

export type KeyStatus = {
  id: number
  suffix: string
  health: KeyHealth
  isActive: boolean
  cooldownUntil: number
  leaseUntil: number
  usageCount: number
}

export function createKeyPool(db: AppDatabase) {
  SqliteAdapter.createTable(db)
  return new KeyPool(new SqliteAdapter(db), {
    defaultCooldownMs: numberEnv('KEY_POOL_DEFAULT_COOLDOWN_MS', DEFAULT_COOLDOWN_MS),
    authCooldownMs: numberEnv('KEY_POOL_AUTH_COOLDOWN_MS', DEFAULT_AUTH_COOLDOWN_MS),
    allocationLeaseMs: numberEnv('KEY_POOL_LEASE_MS', DEFAULT_LEASE_MS)
  })
}

export class KeyPoolRepository {
  private readonly adapter: SqliteAdapter

  constructor(private readonly db: AppDatabase) {
    SqliteAdapter.createTable(db)
    this.adapter = new SqliteAdapter(db)
  }

  importKeys(rawText: string) {
    const { keys, duplicateLines } = parseKeyImport(rawText)
    let inserted = 0
    let duplicate = duplicateLines

    for (const key of keys) {
      try {
        this.adapter.insertKey(key)
        inserted += 1
      } catch {
        duplicate += 1
      }
    }

    return { parsed: keys.length, inserted, duplicate }
  }

  replaceFromKeyManager(keys: string[]) {
    const parsedKeys = keys.filter(isUsableKey)
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE api_keys SET is_active = 0').run()
      for (const key of parsedKeys) {
        this.db.prepare(`
          INSERT INTO api_keys (key, is_active, cooldown_until, lease_until, lease_token, usage_count)
          VALUES (?, 1, 0, 0, NULL, 0)
          ON CONFLICT(key) DO UPDATE SET is_active = 1, cooldown_until = 0, lease_until = 0, lease_token = NULL
        `).run(key)
      }
    })
    transaction()
    return { imported: parsedKeys.length }
  }

  async status(): Promise<KeyStatus[]> {
    const keys = await this.adapter.getKeys()
    return keys.map(toStatus)
  }

  deleteKey(id: number): boolean {
    const result = this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id)
    return result.changes > 0
  }
}

export function parseKeyImport(rawText: string) {
  const seen = new Set<string>()
  const keys: string[] = []
  let duplicateLines = 0
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !isUsableKey(trimmed)) continue
    if (seen.has(trimmed)) {
      duplicateLines += 1
      continue
    }
    seen.add(trimmed)
    keys.push(trimmed)
  }
  return { keys, duplicateLines }
}

export function toStatus(key: ApiKey): KeyStatus {
  const now = Date.now()
  const health: KeyHealth = !key.isActive
    ? 'inactive'
    : key.cooldownUntil > now
      ? 'cooldown'
      : key.leaseUntil > now
        ? 'leased'
        : 'available'

  return {
    id: key.id,
    suffix: key.key.slice(-6),
    health,
    isActive: key.isActive,
    cooldownUntil: key.cooldownUntil,
    leaseUntil: key.leaseUntil,
    usageCount: key.usageCount
  }
}

function isUsableKey(value: string) {
  const lower = value.toLowerCase()
  return /^AIza[\w-]{20,}$/.test(value) && !lower.includes('your_key') && !lower.includes('xxx') && !lower.includes('placeholder')
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
