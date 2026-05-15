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

export type Sentiment = 'anger' | 'complaint' | 'help' | 'sarcasm' | 'neutral' | 'positive' | 'support'

export const SENTIMENT_CLASSES: readonly Sentiment[] = ['anger', 'complaint', 'help', 'sarcasm', 'neutral', 'positive', 'support']

export type ClassifyResult = {
  topic: string
  sensitivity: 'low' | 'medium' | 'high'
  voiceFit: number
  sentiment: Sentiment
  reason: string
}

export type SponsoredSignal = 'none' | 'suspect' | 'likely'

export type SponsoredResult = {
  sponsoredSignal: SponsoredSignal
  reasons: string[]
}

export type ScamSignal = 'none' | 'suspect' | 'likely'

export type ScamResult = {
  scamSignal: ScamSignal
  reasons: string[]
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

export type ComposePostResult = {
  seedKeyword: string
  seedTopic: string
  angle: string
  text: string
  imagePrompt: string
}

export type PipelineResult = {
  classify: ClassifyResult
  sponsored: SponsoredResult | null
  scam: ScamResult | null
  score: ScoreResult
  draft: DraftResult | null
  meme: MemeResult | null
  shortCircuited: boolean
  plannedKeys: Array<{ stepId: string; preferredKey: string | null; sharedFallbackRequired: boolean }>
}

export type SocialPipelineOptions = {
  runSponsored?: boolean
  runScam?: boolean
  runMeme?: boolean
}

export type TextGenerator = (input: { stepId: string; systemInstruction: string; prompt: string; preferredKey: string | null }) => Promise<string>

// 來源：docs/threads-voice-persona.md（2026-05-15 採集，50 題情境答題反推）。
// 細節 + few-shot 範例：packages/server/src/ai/voice-fixtures.json
export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  axes: { sarcasm: 0.8, stance: 0.55, length: 0.15, emojiDensity: 0.02 },
  noGoZones: [
    // 自填
    '身心障礙', '自殺', '求救',
    // skip 模式推斷
    '真實生離死別（癌症安寧、家人重病、失親）',
    '寵物急救',
    '真實被資遣或失業（個人）',
    '政治或公共議題涉及傷亡',
    '性暗示詐騙',
    'PR 公關文 / 企業道歉公關稿',
    '不擅長領域的個人實用建議（二手車、3C 採購等）',
    // 通用
    'personal-attack', 'protected-class', 'doxxing', 'threats'
  ],
  admiredAccounts: [],
  selfDescriptors: [
    '短句一招打死，超過 25 字就不像我',
    '接話延伸，把對方的話往下推一步讓荒謬感自己浮出來',
    '鏡像吐槽，把對方說的話原句反過來丟回去（例如「他也有買給我」「便宜你了」）',
    '反詰戳爆業配 / 炫耀（「您是 X 嗎?」「X?也太久」）',
    '自嘲式更正梗 (X — 台灣 PTT/Threads 經典畫掉自己剛說的話格式',
    '反語安慰（「至少 ...」「還算負責」）',
    '反消費自嘲（「我都用西北風吹，免費」）',
    '戳爆詐騙的內部矛盾',
    '看到真實悲劇就閉嘴，不接梗、不勉強說話',
    '看到 emoji 滿天飛的雞湯零客氣（「宇宙回應我隕石」）',
    '不用 emoji'
  ],
  signaturePhrases: ['便宜你了', '(X', '猛', '幹', '我也想看', '我也想聽', '預算內買最貴的'],
  language: 'zh-TW'
}
