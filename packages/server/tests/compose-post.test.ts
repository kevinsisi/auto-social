import { describe, expect, it } from 'vitest'
import { buildComposePostPrompt, parseComposePost } from '../src/ai/steps/compose-post.js'

describe('compose-post step', () => {
  it('builds a prompt with radar terms and sampled posts', () => {
    const prompt = buildComposePostPrompt({
      seedKeyword: '台灣',
      radarTerms: ['台灣', '生活', '群組'],
      posts: [{ author: '@u', topic: '社交疲勞', excerpt: '最近很多人在講群組訊息跟日常疲勞。' }]
    })

    expect(prompt).toContain('熱門詞：台灣、生活、群組')
    expect(prompt).toContain('author=@u')
    expect(prompt).toContain('社交疲勞')
  })

  it('parses one compose result JSON object', () => {
    const parsed = parseComposePost(JSON.stringify({
      seedKeyword: '台灣',
      seedTopic: '日常觀察',
      angle: '觀察',
      text: '台灣很多事不是突然變怪，是你某天終於有空看清楚。',
      imagePrompt: '台灣城市夜色，便利商店與下班人潮。'
    }))

    expect(parsed.seedKeyword).toBe('台灣')
    expect(parsed.angle).toBe('觀察')
    expect(parsed.text).toContain('突然變怪')
  })

  it('prompt bans AI self-disclosure language', () => {
    const prompt = buildComposePostPrompt({
      seedKeyword: '台灣',
      radarTerms: ['台灣'],
      posts: [{ author: '@u', topic: 't', excerpt: '夠長的一段樣本文字' }]
    })

    expect(prompt).toContain('身為 AI')
    expect(prompt).toContain('作為 AI')
    expect(prompt).toContain('我是 AI')
    expect(prompt).toContain('語言模型')
    expect(prompt).toContain('真人在發 Threads')
  })

  it('prompt instructs imagePrompt to be tied to article content with no style lock', () => {
    const prompt = buildComposePostPrompt({
      seedKeyword: '台灣',
      radarTerms: ['台灣'],
      posts: [{ author: '@u', topic: 't', excerpt: '夠長的一段樣本文字' }]
    })

    expect(prompt).toContain('跟 text 的主題或情緒對應')
    expect(prompt).toContain('風格不限')
  })
})
