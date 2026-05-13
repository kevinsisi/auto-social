import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ClassifyResult, DraftResult, ScoreResult, SourceCandidateInput, VoiceProfile } from '../types.js'

const MAX_VARIANT_CHARS = 35
// Regex covers most emoji ranges; lets the schema reject Gemini outputs that slip emoji in.
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2300}-\u{23FF}‍\u{FE0F}\u{1F200}-\u{1F2FF}]/u

export const draftSchema = z.object({
  variants: z.array(z.object({
    angle: z.string().min(1).max(20),
    text: z.string().min(1).max(MAX_VARIANT_CHARS * 2).refine((text) => !EMOJI_REGEX.test(text), { message: '草稿不可含 emoji' }),
    length: z.number().int().nonnegative()
  })).length(3)
})

export function buildDraftPrompt(candidate: SourceCandidateInput, classify: ClassifyResult, score: ScoreResult, profile: VoiceProfile) {
  return [
    `寫 3 句 Threads 留言草稿。要像台灣真人留言，不是 AI 不是文青不是小編。`,
    ``,
    `硬規則（違反就重寫）：`,
    `- 每句 ≤ ${MAX_VARIANT_CHARS} 字，10-20 字最好，最短可以只有一個字（例：「蹲」、「推」、「真的」）。`,
    `- 不准 emoji，一個都不行。臉、愛心、火、笑哭、emoji 表情符號全部禁。`,
    `- 不准 hashtag、不准 @ 提及、不准放連結。`,
    `- 不要這些開頭：「先說結論」「總而言之」「我覺得」「個人認為」「確實」「其實」「不得不說」「身為 ...」「作為 ...」「值得一提」「老實說」。`,
    `- 不要工整三段論、不要條列、不要「+ 但是 + 然而」。`,
    `- 不准 AI 客氣話：「希望對你有幫助」「祝你順利」「加油哦」「給你一個擁抱」。`,
    `- 不要逐字回應原貼文每一點；挑一個切角，講一句就停。`,
    ``,
    `語感參考（這些是台灣 Threads 真人會用的口氣，自己取捨，不要照抄）：`,
    `「笑死」「真假」「蛤」「蹲」「+1」「推」「推爆」「等更」「好慘」「是說」「啊就」「你以為呢」「嘴角失守」「QQ」「我就問」「不就 ...」「也太」「真的假的」「無言」「躺平」「秒懂」。`,
    `句尾可以省略、可以接「啦」「欸」「捏」「哦」「ㄛ」「咧」「嗎」「吧」。`,
    ``,
    `三個草稿用三個不同切角，angle 用一個 ≤ 6 字的標籤（你自己取，不要硬綁類型）：`,
    `- 例如「冷眼」「自嘲」「同感」「吐槽」「補刀」「神救援」「裝沒事」「乾笑」。`,
    `- 不要三個都是同一種味道；要有差別。`,
    ``,
    `length 欄位 = text 的實際字元數（含標點）。`,
    `原貼文情緒：${classify.sentiment}。題材：${classify.topic}。風險：${score.risk}。禁區：${profile.noGoZones.join('、') || '無'}。`,
    ``,
    `只回 JSON，沒有 markdown、沒有前言：`,
    `{"variants":[{"angle":"冷眼","text":"...","length":12},{"angle":"自嘲","text":"...","length":18},{"angle":"吐槽","text":"...","length":9}]}`,
    ``,
    candidateBlock(candidate)
  ].join('\n')
}

export function parseDraft(raw: string): DraftResult {
  return parseJsonObject(raw, draftSchema, 'draft')
}
