/**
 * opencode-settings.ts — DB-backed OpenCode endpoint configuration.
 *
 * Settings (all under the existing `settings` table, see image-gen/settings.ts):
 *   - openCode.servers  : JSON array of { id, label, baseUrl } in priority order
 *   - openCode.textModel: model id used for text generation (e.g. "google/gemini-2.5-flash")
 *   - openCode.visionModel: model id used for vision/multimodal calls
 *
 * Settings override env (OPENCODE_URL / OPENCODE_BASE_URL). Server password
 * is intentionally NOT a UI setting — it stays env-only via
 * OPENCODE_SERVER_PASSWORD because the canonical HomeProject OpenCode
 * deployment (provider-amd.sisihome.org) is no-auth.
 */

import type { AppDatabase } from './db.js'

const SETTING_SERVERS = 'openCode.servers'
const SETTING_TEXT_MODEL = 'openCode.textModel'
const SETTING_VISION_MODEL = 'openCode.visionModel'

export const DEFAULT_OPENCODE_TEXT_MODEL = 'google/gemini-2.5-flash'
export const DEFAULT_OPENCODE_VISION_MODEL = 'google/gemini-2.5-flash'

export type OpenCodeServer = {
  id: string
  label: string
  baseUrl: string
}

export type OpenCodeSettingSource = 'setting' | 'env' | 'none'

export type OpenCodeStatus = {
  servers: OpenCodeServer[]
  serversSource: OpenCodeSettingSource
  envUrl: string
  textModel: string
  textModelSource: OpenCodeSettingSource
  visionModel: string
  visionModelSource: OpenCodeSettingSource
}

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeServer(raw: unknown, index: number): OpenCodeServer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const baseUrl = trimUrl(String(item.baseUrl ?? item.url ?? ''))
  if (!baseUrl) return null
  const id = String(item.id ?? '').trim() || `opencode-${index + 1}`
  const label = String(item.label ?? '').trim() || `OpenCode ${index + 1}`
  return { id, label, baseUrl }
}

function parseServersValue(raw: unknown): OpenCodeServer[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeServer).filter((server): server is OpenCodeServer => Boolean(server))
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parseServersValue(parsed)
    } catch {
      // fall through to delimiter parsing
    }
    return trimmed
      .split(/[\n,]+/)
      .map((url, index) => normalizeServer({ baseUrl: url }, index))
      .filter((server): server is OpenCodeServer => Boolean(server))
  }
  return []
}

function readEnvServers(): OpenCodeServer[] {
  const envServers = process.env.OPENCODE_SERVERS
  if (envServers && envServers.trim().length > 0) return parseServersValue(envServers)
  const legacyUrl = trimUrl(process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? '')
  if (!legacyUrl) return []
  return [{ id: 'opencode-env', label: 'OpenCode (env)', baseUrl: legacyUrl }]
}

function readJsonSetting(db: AppDatabase, key: string): unknown {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json)
  } catch {
    return null
  }
}

function writeJsonSetting(db: AppDatabase, key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString())
}

function deleteSetting(db: AppDatabase, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getOpenCodeServers(db: AppDatabase): OpenCodeServer[] {
  const fromSetting = parseServersValue(readJsonSetting(db, SETTING_SERVERS))
  if (fromSetting.length > 0) return fromSetting
  return readEnvServers()
}

export function setOpenCodeServers(db: AppDatabase, raw: unknown): void {
  const normalized = parseServersValue(raw)
  if (normalized.length === 0) {
    deleteSetting(db, SETTING_SERVERS)
    return
  }
  writeJsonSetting(db, SETTING_SERVERS, normalized)
}

export function getOpenCodeTextModel(db: AppDatabase): string {
  const fromSetting = readJsonSetting(db, SETTING_TEXT_MODEL)
  if (typeof fromSetting === 'string' && fromSetting.trim().length > 0) return fromSetting.trim()
  const fromEnv = process.env.OPENCODE_MODEL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENCODE_TEXT_MODEL
}

export function setOpenCodeTextModel(db: AppDatabase, model: string): void {
  const trimmed = model.trim()
  if (!trimmed) {
    deleteSetting(db, SETTING_TEXT_MODEL)
    return
  }
  writeJsonSetting(db, SETTING_TEXT_MODEL, trimmed)
}

export function getOpenCodeVisionModel(db: AppDatabase): string {
  const fromSetting = readJsonSetting(db, SETTING_VISION_MODEL)
  if (typeof fromSetting === 'string' && fromSetting.trim().length > 0) return fromSetting.trim()
  const fromEnv = process.env.OPENCODE_VISION_MODEL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENCODE_VISION_MODEL
}

export function setOpenCodeVisionModel(db: AppDatabase, model: string): void {
  const trimmed = model.trim()
  if (!trimmed) {
    deleteSetting(db, SETTING_VISION_MODEL)
    return
  }
  writeJsonSetting(db, SETTING_VISION_MODEL, trimmed)
}

export function clearOpenCodeSettings(db: AppDatabase): void {
  deleteSetting(db, SETTING_SERVERS)
  deleteSetting(db, SETTING_TEXT_MODEL)
  deleteSetting(db, SETTING_VISION_MODEL)
}

export function getOpenCodeStatus(db: AppDatabase): OpenCodeStatus {
  const fromSetting = parseServersValue(readJsonSetting(db, SETTING_SERVERS))
  const envServers = readEnvServers()
  const servers = fromSetting.length > 0 ? fromSetting : envServers
  const serversSource: OpenCodeSettingSource = fromSetting.length > 0 ? 'setting' : envServers.length > 0 ? 'env' : 'none'
  const envUrl = envServers[0]?.baseUrl ?? ''

  const textRaw = readJsonSetting(db, SETTING_TEXT_MODEL)
  const textFromSetting = typeof textRaw === 'string' && textRaw.trim().length > 0 ? textRaw.trim() : null
  const textFromEnv = process.env.OPENCODE_MODEL?.trim() || null
  const textModel = textFromSetting ?? textFromEnv ?? DEFAULT_OPENCODE_TEXT_MODEL
  const textModelSource: OpenCodeSettingSource = textFromSetting ? 'setting' : textFromEnv ? 'env' : 'none'

  const visionRaw = readJsonSetting(db, SETTING_VISION_MODEL)
  const visionFromSetting = typeof visionRaw === 'string' && visionRaw.trim().length > 0 ? visionRaw.trim() : null
  const visionFromEnv = process.env.OPENCODE_VISION_MODEL?.trim() || null
  const visionModel = visionFromSetting ?? visionFromEnv ?? DEFAULT_OPENCODE_VISION_MODEL
  const visionModelSource: OpenCodeSettingSource = visionFromSetting ? 'setting' : visionFromEnv ? 'env' : 'none'

  return { servers, serversSource, envUrl, textModel, textModelSource, visionModel, visionModelSource }
}

/** Server password stays env-only per HomeProject standard (canonical OpenCode is no-auth). */
export function getOpenCodePassword(): string {
  return process.env.OPENCODE_SERVER_PASSWORD ?? ''
}

export type OpenCodeModel = {
  /** Fully-qualified id, e.g. "openai/gpt-5.5" — pass this back as the textModel / visionModel setting. */
  id: string
  /** Display name from the server, falls back to the bare model id. */
  name: string
  /** Underlying provider id within the OpenCode server, e.g. "openai", "google". */
  provider: string
}

export type OpenCodeModelsResult = {
  models: OpenCodeModel[]
  /** id of the server that actually answered; null when every server failed. */
  sourceServerId: string | null
  /** Truncated error message from the last attempted server when all fail. */
  warning: string | null
}

function authHeaders(password: string): Record<string, string> {
  if (!password) return {}
  return {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
  }
}

async function fetchOpenCodeProviders(baseUrl: string, password: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${baseUrl}/provider`, {
      headers: authHeaders(password),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function flattenProviders(raw: unknown): OpenCodeModel[] {
  const providers: Array<{ id?: unknown; models?: unknown }> = Array.isArray(raw)
    ? (raw as Array<{ id?: unknown; models?: unknown }>)
    : Array.isArray((raw as { all?: unknown[] })?.all)
      ? ((raw as { all: Array<{ id?: unknown; models?: unknown }> }).all)
      : []
  const out: OpenCodeModel[] = []
  for (const provider of providers) {
    const pid = typeof provider.id === 'string' ? provider.id : ''
    const modelMap = provider.models
    if (!pid || !modelMap || typeof modelMap !== 'object' || Array.isArray(modelMap)) continue
    for (const [modelId, info] of Object.entries(modelMap as Record<string, unknown>)) {
      const name = info && typeof info === 'object' && typeof (info as { name?: unknown }).name === 'string'
        ? (info as { name: string }).name
        : modelId
      out.push({ id: `${pid}/${modelId}`, name, provider: pid })
    }
  }
  return out
}

/**
 * Walk every configured OpenCode server until one returns its provider list,
 * then flatten the response into `<providerID>/<modelID>` ids the UI can pass
 * back as textModel / visionModel. Result is shaped so the UI can show
 * `sourceServerId` and surface a warning when no server is reachable.
 */
export async function listOpenCodeModels(db: AppDatabase): Promise<OpenCodeModelsResult> {
  const servers = getOpenCodeServers(db)
  if (servers.length === 0) {
    return { models: [], sourceServerId: null, warning: '尚未設定 OpenCode server。' }
  }
  const password = getOpenCodePassword()
  let lastError: unknown = null
  for (const server of servers) {
    try {
      const raw = await fetchOpenCodeProviders(server.baseUrl, password)
      const models = flattenProviders(raw)
      if (models.length > 0) {
        return { models, sourceServerId: server.id, warning: null }
      }
    } catch (err) {
      lastError = err
    }
  }
  const detail = lastError instanceof Error ? lastError.message.slice(0, 160) : null
  return {
    models: [],
    sourceServerId: null,
    warning: detail ?? '無法從任何已設定的 OpenCode server 取得 model 列表。',
  }
}
