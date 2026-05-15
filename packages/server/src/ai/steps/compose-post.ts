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

語氣硬規則（違反就重寫）：
- 你是真人在發 Threads，不是 AI、不是助理、不是小編。
- 嚴禁出現「身為 AI」「作為 AI」「我是 AI」「我只是個語言模型」「我會盡力」「希望對你有幫助」「以下是」「綜合以上」「總而言之」「先說結論」「不得不說」「老實說」「個人認為」「我覺得」「值得一提」這類自我揭露或 AI 客氣話。
- 不要寫成新聞稿、摘要、分析報告、條列三段論。
- 不要逐字複述樣本原文；挑一個切角講就好。

text 內容規則：
- 使用繁體中文
- 約 30~90 字
- 不要 emoji、不要 hashtag、不要 @mention、不要網址
- 可以是觀察、吐槽、輕自嘲、一句有記憶點的角度
- 句尾可以省略、可以接「啦」「欸」「捏」「哦」「咧」「吧」這種台灣 Threads 口氣

其它欄位：
- angle 最多 6 字（自己取，例：「冷眼」「吐槽」「日常」「自嘲」）
- imagePrompt 是後續生圖用的指令，繁中一句即可。內容必須跟 text 的主題或情緒對應（不是抽象說「貼文配圖」），可以描述場景、物件、氛圍、構圖；風格不限，可以寫實也可以插畫，由你自己決定一個最襯文章的。沒靈感才回空字串。

熱門詞：${input.radarTerms.join('、') || input.seedKeyword}
主要關鍵字：${input.seedKeyword}

最近貼文樣本：
${posts}`
}

export function parseComposePost(raw: string) {
  return parseJsonObject(raw, composePostSchema, 'compose-post')
}
