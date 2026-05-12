import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { DraftResult, MemeResult, SourceCandidateInput } from '../types.js'

export const memeSchema = z.object({
  memePrompt: z.string().min(1),
  sceneIdea: z.string().min(1)
})

export function buildMemePrompt(candidate: SourceCandidateInput, draft: DraftResult) {
  return `請產生一個文字型迷因/圖卡 prompt，只回 JSON：{"memePrompt":"...","sceneIdea":"..."}\n\ndraft=${JSON.stringify(draft)}\n\n${candidateBlock(candidate)}`
}

export function parseMeme(raw: string): MemeResult {
  return parseJsonObject(raw, memeSchema, 'meme')
}
