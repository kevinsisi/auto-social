import type { AppDatabase } from '../db.js'

const SETTING_KEY = 'imageGen.apiKey'
const SETTING_MODEL = 'imageGen.model'
// Primary model + fallback chain.
// Per sheet-to-car 2026-05 production: gemini-3-pro-image-preview is the
// highest-quality "Nano Banana" model; gemini-2.5-flash-image (no -preview
// suffix) is the cheaper / faster fallback. The earlier
// `gemini-2.5-flash-image-preview` string was a typo — that model doesn't
// exist on generateContent v1beta.
export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview'
export const FALLBACK_IMAGE_MODELS = ['gemini-2.5-flash-image'] as const

export type ImageGenStatus = {
  configured: boolean
  keySuffix: string | null
  model: string
}

export function getImageGenStatus(db: AppDatabase): ImageGenStatus {
  const key = readSettingString(db, SETTING_KEY)
  const model = readSettingString(db, SETTING_MODEL) ?? DEFAULT_IMAGE_MODEL
  return {
    configured: Boolean(key),
    keySuffix: key ? key.slice(-6) : null,
    model
  }
}

export function getImageGenKey(db: AppDatabase): string | null {
  return readSettingString(db, SETTING_KEY)
}

export function getImageGenModel(db: AppDatabase): string {
  return readSettingString(db, SETTING_MODEL) ?? DEFAULT_IMAGE_MODEL
}

export function setImageGenKey(db: AppDatabase, key: string, model?: string) {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('image gen api key 不能空白。')
  writeSetting(db, SETTING_KEY, trimmed)
  if (model && model.trim()) writeSetting(db, SETTING_MODEL, model.trim())
}

export function clearImageGenKey(db: AppDatabase) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY)
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
