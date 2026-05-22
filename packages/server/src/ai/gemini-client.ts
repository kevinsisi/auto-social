import { GeminiClient } from '@kevinsisi/ai-core/client'
import { KeyPool, type ApiKey, type StorageAdapter } from '@kevinsisi/ai-core/key-pool'
import { OpenCodeProviderAdapter } from '@kevinsisi/ai-core/provider'
import type { TextGenerator } from './types.js'
import { reportToManager } from '../key-pool/report.js'

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_DEFAULT_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const DEFAULT_OPENCODE_MODEL = process.env.OPENCODE_MODEL ?? 'google/gemini-2.5-flash'
const DEFAULT_MAX_OUTPUT_TOKENS = 2048

let cachedOpenCode: OpenCodeProviderAdapter | null = null
let cachedOpenCodeKey = ''

function getOpenCodeAdapter(): OpenCodeProviderAdapter | null {
  const url = (process.env.OPENCODE_URL ?? process.env.OPENCODE_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!url) {
    cachedOpenCode = null
    cachedOpenCodeKey = ''
    return null
  }
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? ''
  // Include password in the cache key so a runtime credential rotation
  // (e.g. secret reload without process restart) takes effect on the next call.
  const cacheKey = `${url}|${password}`
  if (cachedOpenCode && cachedOpenCodeKey === cacheKey) return cachedOpenCode
  cachedOpenCode = new OpenCodeProviderAdapter(
    { type: 'api', provider: 'opencode', apiKey: password, baseURL: url, credentialLabel: 'opencode-primary' },
    { defaultModel: { providerID: 'google', id: 'gemini-2.5-flash' }, basicAuth: !!password }
  )
  cachedOpenCodeKey = cacheKey
  return cachedOpenCode
}


export function createGeminiTextGenerator(model = DEFAULT_GEMINI_MODEL): TextGenerator {
  return async ({ systemInstruction, prompt, preferredKey }) => {
    // OpenCode-primary: when configured, the self-hosted OpenCode server handles
    // text generation. Gemini key-pool is the fallback. The HomeProject vision
    // path stays on direct Gemini fetch (image-recognition.ts); we only route
    // text-only AI through OpenCode.
    const openCode = getOpenCodeAdapter()
    if (openCode) {
      try {
        const response = await openCode.generateContent({
          model: DEFAULT_OPENCODE_MODEL,
          systemInstruction,
          prompt,
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        })
        if (response.text) return response.text
        // Empty text from OpenCode → fall through to Gemini fallback.
      } catch (err) {
        // OpenCode unavailable / rejected the call → fall through to Gemini.
        // We do not throw here because the pipeline plans a Gemini preferredKey
        // for exactly this fallback. Auth-like failures (401/403) deserve
        // operator attention even though we mask the failure for this request,
        // so surface them as console.error rather than console.warn.
        const authLike = isAuthLikeError(err)
        const detail = (err as Error)?.message?.slice(0, 160)
        if (authLike) {
          console.error(`[auto-social] OpenCode auth failure, falling back to Gemini: ${detail}`)
        } else {
          console.warn(`[auto-social] OpenCode generate failed, falling back to Gemini: ${detail}`)
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
