import { describe, expect, it } from 'vitest'
import { buildSponsoredDetectPrompt, parseSponsoredDetect } from '../src/ai/steps/sponsored-detect.js'

const baseCandidate = {
  id: 'cand-test',
  source: 'threads',
  url: 'https://www.threads.com/@user/post/abc',
  title: null,
  text: '今天去喝了一家手搖飲'
}

describe('parseSponsoredDetect', () => {
  it('accepts a clear-non-ad result', () => {
    const raw = JSON.stringify({ sponsoredSignal: 'none', reasons: [] })

    const result = parseSponsoredDetect(raw)

    expect(result.sponsoredSignal).toBe('none')
    expect(result.reasons).toEqual([])
  })

  it('normalises reasons to empty array when sponsoredSignal is none', () => {
    const raw = JSON.stringify({ sponsoredSignal: 'none', reasons: ['誤判的理由'] })

    const result = parseSponsoredDetect(raw)

    expect(result.sponsoredSignal).toBe('none')
    expect(result.reasons).toEqual([])
  })

  it('accepts a suspect result with one reason', () => {
    const raw = JSON.stringify({ sponsoredSignal: 'suspect', reasons: ['過度正向品牌植入'] })

    const result = parseSponsoredDetect(raw)

    expect(result.sponsoredSignal).toBe('suspect')
    expect(result.reasons).toEqual(['過度正向品牌植入'])
  })

  it('accepts a likely result with multiple reasons', () => {
    const raw = JSON.stringify({
      sponsoredSignal: 'likely',
      reasons: ['出現優惠碼', '明示廣告 hashtag', '用語過度乾淨']
    })

    const result = parseSponsoredDetect(raw)

    expect(result.sponsoredSignal).toBe('likely')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects an unknown signal label', () => {
    const raw = JSON.stringify({ sponsoredSignal: 'maybe', reasons: [] })

    expect(() => parseSponsoredDetect(raw)).toThrow()
  })

  it('rejects when reasons is missing', () => {
    const raw = JSON.stringify({ sponsoredSignal: 'suspect' })

    expect(() => parseSponsoredDetect(raw)).toThrow()
  })

  it('rejects when a reason is too long', () => {
    const tooLong = '一'.repeat(80)
    const raw = JSON.stringify({ sponsoredSignal: 'likely', reasons: [tooLong, '另一個理由'] })

    expect(() => parseSponsoredDetect(raw)).toThrow()
  })

  it('parses JSON inside markdown fences', () => {
    const raw = '```json\n{"sponsoredSignal":"likely","reasons":["明示業配","優惠碼"]}\n```'

    const result = parseSponsoredDetect(raw)

    expect(result.sponsoredSignal).toBe('likely')
    expect(result.reasons).toContain('明示業配')
  })
})

describe('buildSponsoredDetectPrompt', () => {
  it('enumerates the five detection signals', () => {
    const prompt = buildSponsoredDetectPrompt(baseCandidate)

    expect(prompt).toContain('品牌植入')
    expect(prompt).toContain('PR 稿')
    expect(prompt).toContain('優惠碼')
    expect(prompt).toContain('#廣告')
    expect(prompt).toContain('品牌名重複')
  })

  it('clarifies sentiment is independent of the sponsored judgement', () => {
    const prompt = buildSponsoredDetectPrompt(baseCandidate)

    expect(prompt).toContain('sentiment')
    expect(prompt).toContain('無關')
  })
})
