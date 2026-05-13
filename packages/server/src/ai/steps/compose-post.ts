import { z } from 'zod'
import { parseJsonObject } from '../json.js'

export type ComposeSeedPost = {
  author: string | null
  topic: string | null
  excerpt: string
}

export type ComposePostInput = {
  seedKeyword: string
  radarTerms: string[]
  posts: ComposeSeedPost[]
}

export const composePostSchema = z.object({
  seedKeyword: z.string().min(1).max(40),
  seedTopic: z.string().min(1).max(80),
  angle: z.string().min(1).max(6),
  text: z.string().min(12).max(180),
  imagePrompt: z.string().max(240)
})

export function buildComposePostPrompt(input: ComposePostInput) {
  const posts = input.posts
    .slice(0, 5)
    .map((post, index) => `${index + 1}. author=${post.author ?? 'unknown'}; topic=${post.topic ?? '未分類'}; excerpt=${post.excerpt}`)
    .join('\n')

  return `你要替我寫一則「我自己要發的原創 Threads 貼文」，不是回覆別人。只回單一 JSON：
{"seedKeyword":"...","seedTopic":"...","angle":"...","text":"...","imagePrompt":"..."}

規則：
- 使用繁體中文
- text 要像真人 Threads 貼文，不是新聞稿，不是摘要，不是分析報告
- text 約 30~90 字
- 不要 emoji、不要 hashtag、不要 @mention、不要網址
- 不要直接複述樣本原文
- 可以是觀察、吐槽、輕自嘲、或一句有記憶點的角度
- angle 最多 6 字
- imagePrompt 是後續生圖參考，一句繁中即可；沒有靈感可給空字串

熱門詞：${input.radarTerms.join('、') || input.seedKeyword}
主要關鍵字：${input.seedKeyword}

最近貼文樣本：
${posts}`
}

export function parseComposePost(raw: string) {
  return parseJsonObject(raw, composePostSchema, 'compose-post')
}
