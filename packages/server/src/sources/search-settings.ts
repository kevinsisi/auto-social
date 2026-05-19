import type { AppDatabase } from '../db.js'

const SETTING_BRAVE_SEARCH_API_KEY = 'search.brave.apiKey'

export type BraveSearchStatus = {
  configured: boolean
  keySuffix: string | null
  source: 'db' | 'env' | null
}

export function getBraveSearchApiKey(db: AppDatabase): string | null {
  return readSettingString(db, SETTING_BRAVE_SEARCH_API_KEY) ?? process.env.BRAVE_SEARCH_API_KEY?.trim() ?? null
}

export function getBraveSearchStatus(db: AppDatabase): BraveSearchStatus {
  const dbKey = readSettingString(db, SETTING_BRAVE_SEARCH_API_KEY)
  const envKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || null
  const key = dbKey ?? envKey
  return {
    configured: Boolean(key),
    keySuffix: key ? key.slice(-6) : null,
    source: dbKey ? 'db' : envKey ? 'env' : null
  }
}

export function setBraveSearchApiKey(db: AppDatabase, key: string) {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Brave Search API key 不能空白。')
  writeSetting(db, SETTING_BRAVE_SEARCH_API_KEY, trimmed)
}

export function clearBraveSearchApiKey(db: AppDatabase) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_BRAVE_SEARCH_API_KEY)
}

function readSettingString(db: AppDatabase, key: string): string | null {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  if (!row) return null
  try {
    const value = JSON.parse(row.value_json)
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function writeSetting(db: AppDatabase, key: string, value: string) {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString())
}
