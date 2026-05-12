import type { SourceCandidateInput, VoiceProfile } from './types.js'

export function buildSystemInstruction(profile: VoiceProfile) {
  return [
    '你是社群海巡工作站的個人小編 AI。',
    '使用繁體中文。不要人身攻擊、不要嘲笑品味或身份、不要威脅、不要 doxxing。',
    `語氣軸：sarcasm=${profile.axes.sarcasm}, stance=${profile.axes.stance}, length=${profile.axes.length}, emojiDensity=${profile.axes.emojiDensity}`,
    `禁區：${profile.noGoZones.join('、') || '無'}`,
    `自我描述：${profile.selfDescriptors.join('、') || '未設定'}`,
    `口頭禪：${profile.signaturePhrases.join('、') || '未設定'}`
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
