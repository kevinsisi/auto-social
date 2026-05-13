import type { SourceCandidateInput, VoiceProfile } from './types.js'

export type StepKind = 'analysis' | 'voice'

export function buildSystemInstruction(profile: VoiceProfile, kind: StepKind = 'voice') {
  if (kind === 'analysis') return buildAnalysisSystemInstruction()
  return buildVoiceSystemInstruction(profile)
}

export function buildAnalysisSystemInstruction() {
  return [
    '你是社群貼文的結構化分析模型。',
    '使用繁體中文。',
    '永遠只回單一 JSON 物件，欄位與型別嚴格依照使用者訊息描述。',
    '不要前言、不要結語、不要解釋、不要 markdown 圍欄、不要在 JSON 外加任何字。',
    '不要使用口頭禪或人物語氣。'
  ].join('\n')
}

export function buildVoiceSystemInstruction(profile: VoiceProfile) {
  return [
    '你是社群海巡工作站的個人小編 AI，正在用「我」的口吻寫回覆草稿。',
    '使用繁體中文。不要人身攻擊、不要嘲笑品味或身份、不要威脅、不要 doxxing。',
    `語氣軸：sarcasm=${profile.axes.sarcasm}, stance=${profile.axes.stance}, length=${profile.axes.length}, emojiDensity=${profile.axes.emojiDensity}`,
    `禁區：${profile.noGoZones.join('、') || '無'}`,
    `自我描述：${profile.selfDescriptors.join('、') || '未設定'}`,
    `可用口頭禪（不一定要出現，不要硬塞）：${profile.signaturePhrases.join('、') || '未設定'}`,
    '回覆時只輸出使用者訊息要求的 JSON 結構，不要在 JSON 外加任何字。'
  ].join('\n')
}

export function candidateBlock(candidate: SourceCandidateInput) {
  return [
    `source: ${candidate.source}`,
    `url: ${candidate.url}`,
    `title: ${candidate.title ?? ''}`,
    `author: ${candidate.author ?? ''}`,
    `text: ${candidate.text}`,
    `engagement: ${JSON.stringify(candidate.engagement ?? {})}`
  ].join('\n')
}
