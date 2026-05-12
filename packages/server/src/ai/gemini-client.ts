import { GeminiClient } from '@kevinsisi/ai-core/client'
import { KeyPool, type ApiKey, type StorageAdapter } from '@kevinsisi/ai-core/key-pool'
import type { TextGenerator } from './types.js'
import { reportToManager } from '../key-pool/report.js'

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_DEFAULT_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

export function createGeminiTextGenerator(model = DEFAULT_GEMINI_MODEL): TextGenerator {
  return async ({ systemInstruction, prompt, preferredKey }) => {
    if (!preferredKey) throw new Error('pipeline_blocked: StepRunner did not allocate a Gemini key')

    const client = new GeminiClient(new KeyPool(new SingleKeyAdapter(preferredKey)), { maxRetries: 0 })
    try {
      const response = await client.generateContent({ model, systemInstruction, prompt, maxOutputTokens: 2048 })
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
