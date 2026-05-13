import { describe, expect, it } from 'vitest'
import { SocialPipeline } from '../src/ai/pipeline.js'
import { DEFAULT_VOICE_PROFILE, type SourceCandidateInput, type TextGenerator } from '../src/ai/types.js'
import { openMemoryDatabase } from '../src/db.js'
import { createKeyPool, KeyPoolRepository } from '../src/key-pool/key-pool.js'

const candidate: SourceCandidateInput = {
  id: 'cand-1',
  source: 'dcard',
  url: 'https://www.dcard.tw/f/trending/p/1',
  title: '大家最近都在聊 AI 小編',
  text: 'AI 小編到底能不能寫得像真人？',
  engagement: { likes: 42 }
}

describe('SocialPipeline', () => {
  it('parses all four step outputs and returns draft + meme', async () => {
    const { pipeline, calls } = await createPipeline(async ({ stepId }) => fixtures[stepId])

    const result = await pipeline.run(candidate)

    expect(result.shortCircuited).toBe(false)
    expect(result.classify.topic).toBe('AI social editor')
    expect(result.score.shouldDraft).toBe(true)
    expect(result.draft?.variants).toHaveLength(3)
    expect(result.meme?.sceneIdea).toContain('小編')
    expect(calls).toEqual(['classify', 'score', 'draft', 'meme'])
  })

  it('short-circuits when score says not to draft', async () => {
    const { pipeline, calls } = await createPipeline(async ({ stepId }) => {
      if (stepId === 'score') return JSON.stringify({ engagementWorth: 0.1, risk: 'high', timeliness: 'cold', shouldDraft: false, reason: '太容易吵起來' })
      return fixtures[stepId]
    })

    const result = await pipeline.run(candidate)

    expect(result.shortCircuited).toBe(true)
    expect(result.draft).toBeNull()
    expect(result.meme).toBeNull()
    expect(calls).toEqual(['classify', 'score'])
  })

  it('short-circuits when classify hits a no-go topic', async () => {
    const { pipeline, calls } = await createPipeline(async ({ stepId }) => {
      if (stepId === 'classify') return JSON.stringify({ topic: 'politics', sensitivity: 'high', voiceFit: 0.1, sentiment: 'anger', reason: '政治高風險' })
      return fixtures[stepId]
    })

    const result = await pipeline.run(candidate)

    expect(result.shortCircuited).toBe(true)
    expect(result.score.reason).toContain('no-go')
    expect(calls).toEqual(['classify'])
  })

  it('blocks drafts when all variants violate no-go zones', async () => {
    const { pipeline } = await createPipeline(async ({ stepId }) => {
      if (stepId === 'draft') {
        return JSON.stringify({ variants: [
          { angle: '觀察家', text: 'politics hot take', length: 17 },
          { angle: '自嘲', text: 'politics again', length: 14 },
          { angle: '短梗', text: 'politics everywhere', length: 19 }
        ] })
      }
      return fixtures[stepId]
    })

    await expect(pipeline.run(candidate)).rejects.toThrow('pipeline_blocked')
  })
})

async function createPipeline(generator: TextGenerator) {
  const db = openMemoryDatabase()
  new KeyPoolRepository(db).importKeys('AIzaValidKey1111111111111111\nAIzaValidKey2222222222222222\nAIzaValidKey3333333333333333\nAIzaValidKey4444444444444444')
  const pool = createKeyPool(db)
  const calls: string[] = []
  const pipeline = new SocialPipeline(pool, async (input) => {
    calls.push(input.stepId)
    return generator(input)
  }, { ...DEFAULT_VOICE_PROFILE, noGoZones: [...DEFAULT_VOICE_PROFILE.noGoZones, 'politics'] })
  return { pipeline, calls }
}

const fixtures: Record<string, string> = {
  classify: JSON.stringify({ topic: 'AI social editor', sensitivity: 'low', voiceFit: 0.8, sentiment: 'neutral', reason: '貼近個人品牌小編題材' }),
  score: JSON.stringify({ engagementWorth: 0.76, risk: 'low', timeliness: 'hot', shouldDraft: true, reason: '熱門且可輕鬆接話' }),
  draft: JSON.stringify({ variants: [
    { angle: '觀察家', text: '先說結論，AI 小編不是要取代人，是幫人少熬一點夜。', length: 31 },
    { angle: '自嘲', text: '我也想像真人，問題是真人小編也常常像機器。', length: 25 },
    { angle: '短梗', text: 'AI：我像真人嗎？小編：先不要互相傷害。', length: 23 }
  ] }),
  meme: JSON.stringify({ memePrompt: '上下對比圖：上方小編熬夜，下方 AI 幫忙整理草稿。', sceneIdea: '小編抱著咖啡盯著螢幕' })
}
