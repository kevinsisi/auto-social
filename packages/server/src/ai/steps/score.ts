import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ClassifyResult, ScoreResult, SourceCandidateInput } from '../types.js'

export const scoreSchema = z.object({
  engagementWorth: z.number().min(0).max(1),
  risk: z.enum(['low', 'medium', 'high']),
  timeliness: z.enum(['cold', 'warm', 'hot']),
  shouldDraft: z.boolean(),
  reason: z.string().min(1)
})

export function buildScorePrompt(candidate: SourceCandidateInput, classify: ClassifyResult) {
  return `請評分這則內容值不值得回，只回 JSON：{"engagementWorth":0-1,"risk":"low|medium|high","timeliness":"cold|warm|hot","shouldDraft":true|false,"reason":"..."}\n\nclassify=${JSON.stringify(classify)}\n\n${candidateBlock(candidate)}`
}

export function parseScore(raw: string): ScoreResult {
  return parseJsonObject(raw, scoreSchema, 'score')
}
