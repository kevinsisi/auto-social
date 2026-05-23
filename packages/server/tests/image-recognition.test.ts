import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { createGeminiImageAnalyzer } from '../src/ai/image-recognition.js'
import { setOpenCodeServers, setOpenCodeVisionModel } from '../src/opencode-settings.js'
import type { SourceCandidateInput } from '../src/ai/types.js'

describe('createGeminiImageAnalyzer', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('uses OpenCode vision before Gemini keys', async () => {
    const db = openMemoryDatabase()
    setOpenCodeServers(db, [{ id: 'oc', label: 'OpenCode', baseUrl: 'https://opencode.test' }])
    setOpenCodeVisionModel(db, 'openai/gpt-5.5')
    const imageUrl = 'https://cdn.example.com/car.jpg'
    const candidate: SourceCandidateInput = { id: 'c1', source: 'threads_search', url: 'https://threads.com/@u/post/1', text: '跑車照片' }
    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === imageUrl) {
        return new Response(Buffer.from('x'.repeat(256)), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      if (href === 'https://opencode.test/session') {
        return Response.json({ id: 'session-1' })
      }
      if (href === 'https://opencode.test/session/session-1/message') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        expect(body.model).toMatchObject({ providerID: 'openai', modelID: 'gpt-5.5' })
        expect(body.parts.some((part: { type?: string; url?: string }) => part.type === 'file' && part.url?.startsWith('data:image/jpeg;base64,'))).toBe(true)
        return Response.json({ parts: [{ type: 'text', text: JSON.stringify({ summary: '一台跑車', images: [{ imageIndex: 1, description: '紅色跑車', textDetected: null, notableObjects: ['跑車'] }] }) }] })
      }
      if (href === 'https://opencode.test/session/session-1') return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch ${href}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createGeminiImageAnalyzer(db)({ candidate, imageUrls: [imageUrl], preferredKey: null })

    expect(result).toMatchObject({ status: 'success', summary: '一台跑車', model: 'openai/gpt-5.5' })
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('generativelanguage.googleapis.com'))).toBe(false)
  })
})
