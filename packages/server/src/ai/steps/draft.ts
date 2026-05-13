import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ClassifyResult, DraftResult, ScoreResult, SourceCandidateInput, VoiceProfile } from '../types.js'

const MAX_VARIANT_CHARS = 40

export const draftSchema = z.object({
  variants: z.array(z.object({
    angle: z.string().min(1),
    text: z.string().min(1).max(MAX_VARIANT_CHARS * 2),
    length: z.number().int().nonnegative()
  })).length(3)
})

export function buildDraftPrompt(candidate: SourceCandidateInput, classify: ClassifyResult, score: ScoreResult, profile: VoiceProfile) {
  return [
    `寫 3 個社群回覆草稿。每個草稿必須符合：`,
    `- text 不可超過 ${MAX_VARIANT_CHARS} 字（含標點），越短越好，能 15-25 字最好。`,
    `- 是「一句話」級別的留言，不是貼文、不是觀後感、不是教學文。`,
    `- 不要逐字回應原貼文每一點；挑一個切角講一句就停。`,
    `- 不要使用「先說結論」、「總而言之」、「我覺得」、「個人認為」之類的開頭。`,
    `- 不要 emoji 連發；最多一個 emoji，可以不用。`,
    `- 不要 hashtag、不要 @ 提及、不要連結。`,
    `- length 欄位填 text 的實際字元數。`,
    ``,
    `三個草稿用三個不同切角：`,
    `- "觀察家"：旁觀客觀，一句看穿、淡淡的，不打算介入。`,
    `- "自嘲"：把自己拉進場、自損但不攻擊原 PO，輕鬆。`,
    `- "短梗"：一句短梗、台式幽默，可以接梗但不要爛梗。`,
    ``,
    `禁區：${profile.noGoZones.join('、') || '無'}。原貼文情緒：${classify.sentiment}。`,
    `題材：${classify.topic}。風險：${score.risk}。`,
    ``,
    `只回 JSON，不要前言、不要 markdown：`,
    `{"variants":[{"angle":"觀察家","text":"...","length":18},{"angle":"自嘲","text":"...","length":22},{"angle":"短梗","text":"...","length":14}]}`,
    ``,
    candidateBlock(candidate)
  ].join('\n')
}

export function parseDraft(raw: string): DraftResult {
  return parseJsonObject(raw, draftSchema, 'draft')
}
