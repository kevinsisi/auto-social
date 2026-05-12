import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ClassifyResult, SourceCandidateInput } from '../types.js'

export const classifySchema = z.object({
  topic: z.string().min(1),
  sensitivity: z.enum(['low', 'medium', 'high']),
  voiceFit: z.number().min(0).max(1),
  reason: z.string().min(1)
})

export function buildClassifyPrompt(candidate: SourceCandidateInput) {
  return `請分類這則社群候選內容，只回 JSON：{"topic":"...","sensitivity":"low|medium|high","voiceFit":0-1,"reason":"..."}\n\n${candidateBlock(candidate)}`
}

export function parseClassify(raw: string): ClassifyResult {
  return parseJsonObject(raw, classifySchema, 'classify')
}
