import type { AppDatabase } from '../db.js'

const SETTING_BRAVE_SEARCH_API_KEY = 'search.brave.apiKey'
const SETTING_GOOGLE_CSE_API_KEY = 'search.googleCse.apiKey'
const SETTING_GOOGLE_CSE_CX = 'search.googleCse.cx'

export type BraveSearchStatus = {
  configured: boolean
  keySuffix: string | null
  source: 'db' | 'env' | null
}

export type GoogleCseConfig = {
  apiKey: string
  cx: string
}

export type GoogleCseStatus = {
  configured: boolean
  keyConfigured: boolean
  keySuffix: string | null
  cx: string | null
  keySource: 'db' | 'env' | null
  cxSource: 'db' | 'env' | null
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

export function getGoogleCseConfig(db: AppDatabase): GoogleCseConfig | null {
  const apiKey = readSettingString(db, SETTING_GOOGLE_CSE_API_KEY) ?? readEnv('GOOGLE_SEARCH_API_KEY', 'GOOGLE_CSE_API_KEY')
  const cx = readSettingString(db, SETTING_GOOGLE_CSE_CX) ?? readEnv('GOOGLE_SEARCH_CX', 'GOOGLE_CSE_CX')
  return apiKey && cx ? { apiKey, cx } : null
}

export function getGoogleCseStatus(db: AppDatabase): GoogleCseStatus {
  const dbKey = readSettingString(db, SETTING_GOOGLE_CSE_API_KEY)
  const envKey = readEnv('GOOGLE_SEARCH_API_KEY', 'GOOGLE_CSE_API_KEY')
  const dbCx = readSettingString(db, SETTING_GOOGLE_CSE_CX)
  const envCx = readEnv('GOOGLE_SEARCH_CX', 'GOOGLE_CSE_CX')
  const apiKey = dbKey ?? envKey
  const cx = dbCx ?? envCx
  return {
    configured: Boolean(apiKey && cx),
    keyConfigured: Boolean(apiKey),
    keySuffix: apiKey ? apiKey.slice(-6) : null,
    cx,
    keySource: dbKey ? 'db' : envKey ? 'env' : null,
    cxSource: dbCx ? 'db' : envCx ? 'env' : null
  }
}

export function setGoogleCseConfig(db: AppDatabase, config: Partial<GoogleCseConfig>) {
  const apiKey = config.apiKey?.trim()
  const cx = config.cx?.trim()
  if (apiKey) writeSetting(db, SETTING_GOOGLE_CSE_API_KEY, apiKey)
  if (cx) writeSetting(db, SETTING_GOOGLE_CSE_CX, cx)
}

export function clearGoogleCseConfig(db: AppDatabase) {
  const statement = db.prepare('DELETE FROM settings WHERE key = ?')
  statement.run(SETTING_GOOGLE_CSE_API_KEY)
  statement.run(SETTING_GOOGLE_CSE_CX)
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
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
