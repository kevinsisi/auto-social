import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { isForbiddenDraft } from '../src/humor.js'
import { isThreadsUrl, PatrolRepository } from '../src/repository.js'

describe('PatrolRepository', () => {
  it('preserves the submitted keyword when creating a patrol card', () => {
    const repo = new PatrolRepository(openMemoryDatabase())

    const card = repo.createCard('中古車收購')

    expect(card.keyword).toBe('中古車收購')
  })

  it('rejects empty keywords', () => {
    const repo = new PatrolRepository(openMemoryDatabase())

    expect(() => repo.createCard('   ')).toThrow('請先輸入關鍵字')
  })

  it('imports a manual Threads link and generates reply suggestions', () => {
    const repo = new PatrolRepository(openMemoryDatabase())
    const card = repo.createCard('中古車')

    const candidate = repo.addManualCandidate(card.id, 'https://www.threads.net/@meetcar/post/abc', '想買中古車', '價格是不是都很玄')

    expect(candidate.analysis?.suggestions).toHaveLength(2)
    expect(candidate.analysis?.suggestions[0]?.label).toBe('普通')
    expect(candidate.analysis?.suggestions[1]?.label).toBe('比較酸')
  })

  it('does not fabricate reply drafts for URL-only candidates', () => {
    const repo = new PatrolRepository(openMemoryDatabase())
    const card = repo.createCard('中古車')

    const candidate = repo.addManualCandidate(card.id, 'https://www.threads.net/@meetcar/post/url-only')

    expect(candidate.analysis?.worthReplying).toBe(false)
    expect(candidate.analysis?.suggestions).toHaveLength(0)
    expect(candidate.analysis?.summary).toContain('目前只有連結')
  })

  it('updates candidate status', () => {
    const repo = new PatrolRepository(openMemoryDatabase())
    const card = repo.createCard('中古車')
    const candidate = repo.addManualCandidate(card.id, 'https://www.threads.net/@meetcar/post/abc')

    const updated = repo.updateCandidateStatus(candidate.id, 'replied')

    expect(updated?.status).toBe('replied')
    expect(updated?.cardId).toBe(card.id)
  })
})

describe('Threads URL validation', () => {
  it('accepts Threads URLs only', () => {
    expect(isThreadsUrl('https://www.threads.net/@meetcar/post/abc')).toBe(true)
    expect(isThreadsUrl('https://example.com/post/abc')).toBe(false)
  })
})

describe('humor safety', () => {
  it('blocks forbidden personal-attack wording', () => {
    expect(isForbiddenDraft('這樣講有點白癡')).toBe(true)
    expect(isForbiddenDraft('證據追不上結論啦')).toBe(false)
  })
})
