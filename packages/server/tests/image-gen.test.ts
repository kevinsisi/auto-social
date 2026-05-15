import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDatabase } from '../src/db.js'
import { clearImageGenKey, getImageGenStatus, setImageGenKey } from '../src/image-gen/settings.js'
import { generateImageForDraft, ImageGenFailedError, ImageGenNotConfiguredError } from '../src/image-gen/gemini-image.js'

describe('image-gen settings', () => {
  it('reports configured=false initially and round-trips key + model', () => {
    const db = openMemoryDatabase()
    expect(getImageGenStatus(db).configured).toBe(false)

    setImageGenKey(db, 'AIzaTestKey123456', 'imagen-4-fast-generate-001')
    const s = getImageGenStatus(db)
    expect(s.configured).toBe(true)
    expect(s.keySuffix).toBe('123456')
    expect(s.model).toBe('imagen-4-fast-generate-001')

    clearImageGenKey(db)
    expect(getImageGenStatus(db).configured).toBe(false)
  })

  it('falls back to default model when none is given', () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    expect(getImageGenStatus(db).model).toBe('gemini-2.5-flash-image-preview')
  })

  it('rejects empty key', () => {
    const db = openMemoryDatabase()
    expect(() => setImageGenKey(db, '   ')).toThrow()
  })
})

describe('generateImageForDraft', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'autosocial-img-')) })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks() })

  it('throws ImageGenNotConfiguredError when no key is set', async () => {
    const db = openMemoryDatabase()
    await expect(generateImageForDraft(db, 'd1', 'a cat', tmp)).rejects.toBeInstanceOf(ImageGenNotConfiguredError)
  })

  it('throws ImageGenFailedError when prompt is empty', async () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    await expect(generateImageForDraft(db, 'd1', '   ', tmp)).rejects.toBeInstanceOf(ImageGenFailedError)
  })

  it('writes the decoded PNG bytes to data/post-images/<id>.png on success', async () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    const pngBytes = Buffer.from('a'.repeat(256), 'utf8')
    const base64 = pngBytes.toString('base64')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example/api',
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: base64 } }] } }] })
    }))

    const result = await generateImageForDraft(db, 'd1', 'a sleepy cat', tmp)
    expect(result.relativePath).toBe('post-images/d1.png')
    expect(result.mimeType).toBe('image/png')
    const written = readFileSync(result.absolutePath)
    expect(written.equals(pngBytes)).toBe(true)
  })

  it('surfaces the Gemini error message on non-200 response', async () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      url: 'https://example/api',
      text: async () => JSON.stringify({ error: { message: 'Quota exceeded for image gen' } })
    }))

    await expect(generateImageForDraft(db, 'd1', 'a sleepy cat', tmp)).rejects.toThrow(/Quota exceeded for image gen/)
  })

  it('rejects when the API returns no image part', async () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example/api',
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image here' }] } }] })
    }))

    await expect(generateImageForDraft(db, 'd1', 'a sleepy cat', tmp)).rejects.toThrow(/沒有回傳圖片內容/)
  })

  it('rejects suspiciously small image payloads', async () => {
    const db = openMemoryDatabase()
    setImageGenKey(db, 'AIzaTestKey0000000')
    const tinyBase64 = Buffer.from('xx').toString('base64')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example/api',
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: tinyBase64 } }] } }] })
    }))

    await expect(generateImageForDraft(db, 'd1', 'a sleepy cat', tmp)).rejects.toThrow(/資料過小/)
  })
})
