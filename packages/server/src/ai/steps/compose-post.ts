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

// Phrases that betray "this was written by an AI assistant". The prompt
// already lists these as forbidden but Gemini occasionally still emits
// them, especially `先說結論` and `身為 AI`. The schema-level refine forces
// the output to be regenerated instead of persisting AI-flavoured drafts.
const BANNED_OPENERS = [
  '身為AI', '作為AI', '我是AI', '身為 AI', '作為 AI', '我是 AI', '我只是個語言模型', '語言模型',
  '我會盡力', '希望對你有幫助', '希望這個',
  '以下是', '綜合以上', '總而言之', '先說結論',
  '不得不說', '老實說', '個人認為', '我覺得', '值得一提'
]
const BANNED_OPENERS_RE = new RegExp(BANNED_OPENERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))

export function isSafeComposePostText(text: string) {
  const compact = text.replace(/\s+/g, '')
  return !text.includes('�') && !BANNED_OPENERS_RE.test(text) && !BANNED_OPENERS_RE.test(compact)
}

export const composePostSchema = z.object({
  seedKeyword: z.string().min(1).max(40),
  seedTopic: z.string().min(1).max(80),
  angle: z.string().min(1).max(6),
  text: z.string()
    .min(12)
    .max(120)
    .refine(isSafeComposePostText, { message: 'text 含被禁的 AI 自我揭露 / 客氣話術，請重寫' }),
  imagePrompt: z.string().max(240)
})

export function buildComposePostPrompt(input: ComposePostInput) {
  const posts = input.posts
    .slice(0, 5)
    .map((post, index) => `${index + 1}. author=${post.author ?? 'unknown'}; topic=${post.topic ?? '未分類'}; excerpt=${post.excerpt}`)
    .join('\n')

  return `你要替我寫一則「我自己要發的原創 Threads 貼文」，不是回覆別人。只回單一 JSON：
{"seedKeyword":"...","seedTopic":"...","angle":"...","text":"...","imagePrompt":"..."}

語氣硬規則（違反就重寫，schema 會擋）：
- 你是真人在發 Threads，不是 AI、不是助理、不是小編、不是文案。
- 嚴禁出現：「身為 AI」「作為 AI」「我是 AI」「我只是個語言模型」「我會盡力」「希望對你有幫助」「希望這個」「以下是」「綜合以上」「總而言之」「先說結論」「不得不說」「老實說」「個人認為」「我覺得」「值得一提」「顯得」「總是」。
- 不要寫成新聞稿、摘要、分析報告、心靈雞湯、感悟散文。
- 不要逐字複述樣本原文；挑一個切角講就好。
- 不要鋪陳「聽說 X？... 其實 Y」這種文青起手式；直接講結論或直接吐槽。

text 內容規則：
- 使用繁體中文
- 約 20~80 字（短一點比長一點好。25 字一句到底常常最強）
- 不要 emoji、不要 hashtag、不要 @mention、不要網址
- 可以是觀察、吐槽、輕自嘲、一句有記憶點的角度
- 句尾可以省略、可以接「啦」「欸」「捏」「哦」「咧」「吧」這種台灣 Threads 口氣

語感參考（Kevin 真實 Threads 風格 — 同樣是短梗 + 反差接梗 + 鏡像吐槽 + 反詰戳爆，自己抓 vibe 不要照抄）：
- 「每件事都緊急，那就是每件事都不急」
- 「我都用西北風吹，免費」
- 「五分鐘?也太久」
- 「您是咖啡師嗎?」
- 「便宜你了」
- 「至少你們大家齊聚一堂聊天」
- 「猛，我都睡大安森林公園」
- 「宇宙回應我隕石」

其它欄位：
- angle 最多 6 字（自己取，例：「冷眼」「吐槽」「日常」「自嘲」「補刀」）
- imagePrompt 是後續生圖用的指令，繁中一句即可。內容必須跟 text 的主題或情緒對應（不是抽象說「貼文配圖」），可以描述場景、物件、氛圍、構圖；風格不限，可以寫實也可以插畫，由你自己決定一個最襯文章的。沒靈感才回空字串。
- imagePrompt 重要規則：**不要要求畫中文字** — 不要說「招牌寫著 XX」「看板上的中文字」「手寫紙條寫 XX」「便當盒貼著 XX」。Gemini 圖像 model 渲染 CJK 必然亂碼（例：士林夜市 → 土綱夜市）。要傳達訊息靠構圖、光線、人物表情、物件、配色，不靠字。如果非要表達特定地點，描述地標（101、捷運站、夜市攤位形狀）而不是寫地名招牌。

熱門詞：${input.radarTerms.join('、') || input.seedKeyword}
主要關鍵字：${input.seedKeyword}

最近貼文樣本：
${posts}`
}

export function parseComposePost(raw: string) {
  return parseJsonObject(raw, composePostSchema, 'compose-post')
}
