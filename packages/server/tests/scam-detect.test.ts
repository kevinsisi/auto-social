import { describe, expect, it } from 'vitest'
import { buildScamDetectPrompt, parseScamDetect } from '../src/ai/steps/scam-detect.js'

const baseCandidate = {
  id: 'cand-test',
  source: 'threads',
  url: 'https://www.threads.com/@u/post/abc',
  title: null,
  text: '範例貼文'
}

describe('parseScamDetect', () => {
  it('accepts a clear-non-scam result', () => {
    const raw = JSON.stringify({ scamSignal: 'none', reasons: [] })

    expect(parseScamDetect(raw)).toEqual({ scamSignal: 'none', reasons: [] })
  })

  it('normalises reasons to empty when scamSignal is none', () => {
    const raw = JSON.stringify({ scamSignal: 'none', reasons: ['誤判'] })

    expect(parseScamDetect(raw)).toEqual({ scamSignal: 'none', reasons: [] })
  })

  it('accepts suspect with one reason', () => {
    const raw = JSON.stringify({ scamSignal: 'suspect', reasons: ['出現可疑短網域'] })

    const result = parseScamDetect(raw)

    expect(result.scamSignal).toBe('suspect')
    expect(result.reasons).toEqual(['出現可疑短網域'])
  })

  it('accepts likely with multiple reasons', () => {
    const raw = JSON.stringify({
      scamSignal: 'likely',
      reasons: ['性暗示邀約配價目', '導向 LINE 私訊', '不戴不負責話術']
    })

    const result = parseScamDetect(raw)

    expect(result.scamSignal).toBe('likely')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects unknown signal', () => {
    expect(() => parseScamDetect(JSON.stringify({ scamSignal: 'maybe', reasons: [] }))).toThrow()
  })

  it('rejects when reasons missing', () => {
    expect(() => parseScamDetect(JSON.stringify({ scamSignal: 'suspect' }))).toThrow()
  })

  it('parses markdown-fenced JSON', () => {
    const raw = '```json\n{"scamSignal":"likely","reasons":["性暗示邀約","可疑 LINE ID"]}\n```'

    expect(parseScamDetect(raw).scamSignal).toBe('likely')
  })
})

describe('buildScamDetectPrompt', () => {
  it('enumerates the six scam signals', () => {
    const prompt = buildScamDetectPrompt(baseCandidate)

    expect(prompt).toContain('性暗示邀約')
    expect(prompt).toContain('私訊誘導')
    expect(prompt).toContain('假投資')
    expect(prompt).toContain('釣魚連結')
    expect(prompt).toContain('制式話術')
    expect(prompt).toContain('急迫感')
  })

  it('declares orthogonality to sentiment and sponsored', () => {
    const prompt = buildScamDetectPrompt(baseCandidate)

    expect(prompt).toContain('sentiment')
    expect(prompt).toContain('葉配')
    expect(prompt).toContain('獨立')
  })
})
