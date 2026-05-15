import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { KeyPoolRepository, parseKeyImport } from '../src/key-pool/key-pool.js'

describe('key pool import', () => {
  it('parses batch import text and ignores comments/placeholders', () => {
    expect(parseKeyImport(['# comment', 'AIzaValidKey1111111111111111', 'YOUR_KEY_HERE', 'xxx', '', 'AIzaValidKey1111111111111111'].join('\n')))
      .toEqual({ keys: ['AIzaValidKey1111111111111111'], duplicateLines: 1 })
  })

  it('imports keys and reports duplicate rows', async () => {
    const repo = new KeyPoolRepository(openMemoryDatabase())

    const result = repo.importKeys('AIzaValidKey1111111111111111\nAIzaValidKey2222222222222222\nAIzaValidKey1111111111111111')
    const status = await repo.status()

    expect(result).toEqual({ parsed: 2, inserted: 2, duplicate: 1 })
    expect(status).toHaveLength(2)
    expect(status.every((key) => key.health === 'available')).toBe(true)
  })

  it('deleteKey removes a specific key by id and reports false for unknown ids', async () => {
    const repo = new KeyPoolRepository(openMemoryDatabase())
    repo.importKeys('AIzaValidKey1111111111111111\nAIzaValidKey2222222222222222\nAIzaValidKey3333333333333333')
    const before = await repo.status()
    expect(before).toHaveLength(3)

    const targetId = before[1].id
    expect(repo.deleteKey(targetId)).toBe(true)

    const after = await repo.status()
    expect(after).toHaveLength(2)
    expect(after.map((k) => k.id)).not.toContain(targetId)

    expect(repo.deleteKey(targetId)).toBe(false)
    expect(repo.deleteKey(999999)).toBe(false)
  })
})
