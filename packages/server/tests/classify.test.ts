import { describe, expect, it } from 'vitest'
import { buildClassifyPrompt, parseClassify } from '../src/ai/steps/classify.js'
import { SENTIMENT_CLASSES } from '../src/ai/types.js'

const baseCandidate = {
  id: 'cand-test',
  source: 'threads',
  url: 'https://www.threads.com/@user/post/abc',
  title: null,
  text: '隨手寫一句測試'
}

describe('parseClassify', () => {
  it('accepts every supported sentiment class', () => {
    for (const sentiment of SENTIMENT_CLASSES) {
      const raw = JSON.stringify({ topic: 't', sensitivity: 'low', voiceFit: 0.5, sentiment, reason: 'r' })
      const result = parseClassify(raw)
      expect(result.sentiment).toBe(sentiment)
    }
  })

  it('rejects an unknown sentiment label', () => {
    const raw = JSON.stringify({ topic: 't', sensitivity: 'low', voiceFit: 0.5, sentiment: 'happy-go-lucky', reason: 'r' })

    expect(() => parseClassify(raw)).toThrow()
  })

  it('rejects when the sentiment field is missing', () => {
    const raw = JSON.stringify({ topic: 't', sensitivity: 'low', voiceFit: 0.5, reason: 'r' })

    expect(() => parseClassify(raw)).toThrow()
  })

  it('parses JSON wrapped in markdown fences', () => {
    const raw = '```json\n{"topic":"買房","sensitivity":"medium","voiceFit":0.7,"sentiment":"complaint","reason":"抱怨房價"}\n```'

    const result = parseClassify(raw)

    expect(result.topic).toBe('買房')
    expect(result.sentiment).toBe('complaint')
  })
})

describe('buildClassifyPrompt', () => {
  it('lists every sentiment class in the instruction', () => {
    const prompt = buildClassifyPrompt(baseCandidate)

    for (const sentiment of SENTIMENT_CLASSES) {
      expect(prompt).toContain(sentiment)
    }
  })

  it('includes the candidate text in the prompt body', () => {
    const prompt = buildClassifyPrompt({ ...baseCandidate, text: '今天台北下雨好煩' })

    expect(prompt).toContain('今天台北下雨好煩')
  })
})
