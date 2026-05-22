import { GeminiClient } from '@kevinsisi/ai-core/client'
import { KeyPool, type ApiKey, type StorageAdapter } from '@kevinsisi/ai-core/key-pool'
import { OpenCodeProviderAdapter } from '@kevinsisi/ai-core/provider'
import type { TextGenerator } from './types.js'
import { reportToManager } from '../key-pool/report.js'
import type { AppDatabase } from '../db.js'
import { getOpenCodePassword, getOpenCodeServers, getOpenCodeTextModel, getOpenCodeTextVariant, type OpenCodeServer } from '../opencode-settings.js'

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_DEFAULT_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const DEFAULT_MAX_OUTPUT_TOKENS = 2048

interface CachedAdapter {
  server: OpenCodeServer
  adapter: OpenCodeProviderAdapter
}

let cachedAdapters: CachedAdapter[] = []
let cachedSignature = ''

function buildAdapter(server: OpenCodeServer, password: string, variant: string): OpenCodeProviderAdapter {
  return new OpenCodeProviderAdapter(
    { type: 'api', provider: 'opencode', apiKey: password, baseURL: server.baseUrl, credentialLabel: server.id },
    { defaultModel: { providerID: 'google', id: 'gemini-2.5-flash' }, basicAuth: !!password, variant },
  )
}

function getOpenCodeAdapters(db: AppDatabase | null): CachedAdapter[] {
  const servers: OpenCodeServer[] = db
    ? getOpenCodeServers(db)
    : (() => {
        const envList = process.env.OPENCODE_SERVERS
        if (envList && envList.trim().length > 0) {
          return envList
            .split(/[\n,]+/)
            .map((url, index) => ({ id: `opencode-env-${index + 1}`, label: `OpenCode env ${index + 1}`, baseUrl: url.trim().replace(/\/+$/, '') }))
            .filter((s) => s.baseUrl.length > 0)
        }
        const legacy = (process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? '').trim().replace(/\/+$/, '')
        return legacy ? [{ id: 'opencode-env', label: 'OpenCode (env)', baseUrl: legacy }] : []
      })()
  if (servers.length === 0) {
    cachedAdapters = []
    cachedSignature = ''
    return cachedAdapters
  }
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? ''
  const variant = db ? getOpenCodeTextVariant(db) : 'medium'
  const signature = `${password}|${variant}|${servers.map((s) => `${s.id}=${s.baseUrl}`).join('|')}`
  if (cachedSignature === signature && cachedAdapters.length === servers.length) return cachedAdapters
  cachedAdapters = servers.map((server) => ({ server, adapter: buildAdapter(server, password, variant) }))
  cachedSignature = signature
  return cachedAdapters
}

export function createGeminiTextGenerator(db: AppDatabase | null = null, model = DEFAULT_GEMINI_MODEL): TextGenerator {
  return async ({ systemInstruction, prompt, preferredKey }) => {
    // OpenCode-primary: walk every configured OpenCode server in order until
    // one succeeds. Gemini key-pool is the fallback after all servers fail.
    // The HomeProject vision path stays on direct Gemini fetch
    // (image-recognition.ts); we only route text-only AI through OpenCode.
    const adapters = getOpenCodeAdapters(db)
    if (adapters.length > 0) {
      const openCodeModel = db ? getOpenCodeTextModel(db) : (process.env.OPENCODE_MODEL ?? 'google/gemini-2.5-flash')
      for (const { server, adapter } of adapters) {
        try {
          const response = await adapter.generateContent({
            model: openCodeModel,
            systemInstruction,
            prompt,
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
          if (response.text) return response.text
          // Empty text from this server → try the next server.
        } catch (err) {
          // This server failed → log appropriately and try next; if all fail,
          // we fall through to Gemini key-pool below.
          const detail = (err as Error)?.message?.slice(0, 160)
          if (isAuthLikeError(err)) {
            console.error(`[auto-social] OpenCode ${server.id} auth failure: ${detail}`)
          } else {
            console.warn(`[auto-social] OpenCode ${server.id} failed: ${detail}`)
          }
        }
      }
    }

    if (!preferredKey) throw new Error('pipeline_blocked: OpenCode unavailable and StepRunner did not allocate a Gemini fallback key')

    const client = new GeminiClient(new KeyPool(new SingleKeyAdapter(preferredKey)), { maxRetries: 0 })
    try {
      const response = await client.generateContent({ model, systemInstruction, prompt, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS })
      await reportBestEffort(preferredKey.slice(-6), 'success')
      return response.text
    } catch (error) {
      await reportBestEffort(preferredKey.slice(-6), isAuthLikeError(error) ? 'auth_failure' : 'cooldown')
      throw error
    }
  }
}

class SingleKeyAdapter implements StorageAdapter {
  private key: ApiKey

  constructor(apiKey: string) {
    this.key = { id: 1, key: apiKey, isActive: true, cooldownUntil: 0, leaseUntil: 0, leaseToken: null, usageCount: 0 }
  }

  async getKeys() {
    return [this.key]
  }

  async acquireLease(_keyId: number, leaseUntil: number, leaseToken: string) {
    this.key = { ...this.key, leaseUntil, leaseToken }
    return true
  }

  async renewLease(_keyId: number, leaseUntil: number, leaseToken: string) {
    if (this.key.leaseToken !== leaseToken) return false
    this.key = { ...this.key, leaseUntil }
    return true
  }

  async updateKey(key: ApiKey) {
    this.key = key
  }
}

function isAuthLikeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /401|403|api key|permission|auth/i.test(text)
}

async function reportBestEffort(keySuffix: string, status: 'success' | 'cooldown' | 'auth_failure') {
  try {
    await reportToManager(keySuffix, status)
  } catch {
    // key-manager reporting is telemetry; never mask the primary Gemini result.
  }
}
