export type SourceCandidateInput = {
  id: string
  source: string
  url: string
  title?: string | null
  text: string
  author?: string | null
  engagement?: Record<string, unknown> | null
}

export type VoiceProfile = {
  axes: {
    sarcasm: number
    stance: number
    length: number
    emojiDensity: number
  }
  noGoZones: string[]
  admiredAccounts: Array<{ handle: string; description?: string; samplePost?: string }>
  selfDescriptors: string[]
  signaturePhrases: string[]
  language: 'zh-TW' | 'en'
}

export type ClassifyResult = {
  topic: string
  sensitivity: 'low' | 'medium' | 'high'
  voiceFit: number
  reason: string
}

export type ScoreResult = {
  engagementWorth: number
  risk: 'low' | 'medium' | 'high'
  timeliness: 'cold' | 'warm' | 'hot'
  shouldDraft: boolean
  reason: string
}

export type DraftResult = {
  variants: Array<{ angle: string; text: string; length: number }>
}

export type MemeResult = {
  memePrompt: string
  sceneIdea: string
}

export type PipelineResult = {
  classify: ClassifyResult
  score: ScoreResult
  draft: DraftResult | null
  meme: MemeResult | null
  shortCircuited: boolean
  plannedKeys: Array<{ stepId: string; preferredKey: string | null; sharedFallbackRequired: boolean }>
}

export type TextGenerator = (input: { stepId: string; systemInstruction: string; prompt: string; preferredKey: string | null }) => Promise<string>

export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  axes: { sarcasm: 0.45, stance: 0.45, length: 0.3, emojiDensity: 0.05 },
  noGoZones: ['politics', 'religion', 'personal-attack', 'protected-class', 'doxxing', 'threats'],
  admiredAccounts: [],
  selfDescriptors: ['直接不刻薄', '好笑但不攻擊真人'],
  signaturePhrases: ['先說結論'],
  language: 'zh-TW'
}
