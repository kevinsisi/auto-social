import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ClassifyResult, DraftResult, ScoreResult, SourceCandidateInput, VoiceProfile } from '../types.js'

export const draftSchema = z.object({
  variants: z.array(z.object({
    angle: z.string().min(1),
    text: z.string().min(1),
    length: z.number().int().nonnegative()
  })).length(3)
})

export function buildDraftPrompt(candidate: SourceCandidateInput, classify: ClassifyResult, score: ScoreResult, profile: VoiceProfile) {
  return `請依 voice profile 寫 3 個社群回覆草稿，只回 JSON：{"variants":[{"angle":"觀察家|自嘲|短梗","text":"...","length":123}]}\n\nvoice=${JSON.stringify(profile)}\nclassify=${JSON.stringify(classify)}\nscore=${JSON.stringify(score)}\n\n${candidateBlock(candidate)}`
}

export function parseDraft(raw: string): DraftResult {
  return parseJsonObject(raw, draftSchema, 'draft')
}
