import { describe, expect, it } from 'vitest'
import { extractRadarTerms } from '../src/radar-trends.js'

describe('extractRadarTerms', () => {
  it('derives terms from candidate text without canned defaults', () => {
    const terms = extractRadarTerms('台灣早餐店今天討論 AI 影片。台灣創作者分享 AI 影片工作流。')

    expect(terms).toEqual(expect.arrayContaining([
      { word: 'AI', count: 2 },
      { word: '台灣', count: 2 },
      { word: '影片', count: 2 }
    ]))
    expect(terms.some((term) => term.word === 'AI 小編')).toBe(false)
  })
})
