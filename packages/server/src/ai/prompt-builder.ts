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
    '你正在用「我」的口吻寫個人在 Threads 的貼文 / 留言，是真人發文，不是助理也不是小編。',
    '使用繁體中文。不要人身攻擊、不要嘲笑品味或身份、不要威脅、不要 doxxing。',
    '嚴禁自我揭露為 AI / 語言模型 / 助理。不要說「身為 AI」「作為 AI」「我是 AI」「以下是」「我會盡力」「希望對你有幫助」「綜合以上」「總而言之」「先說結論」這類話術。',
    `語氣軸：sarcasm=${profile.axes.sarcasm}, stance=${profile.axes.stance}, length=${profile.axes.length}, emojiDensity=${profile.axes.emojiDensity}`,
    `禁區：${profile.noGoZones.join('、') || '無'}`,
    `自我描述：${profile.selfDescriptors.join('、') || '未設定'}`,
    `可用口頭禪（不一定要出現，不要硬塞）：${profile.signaturePhrases.join('、') || '未設定'}`,
    '回覆時只輸出使用者訊息要求的 JSON 結構，不要在 JSON 外加任何字。'
  ].join('\n')
}

export function candidateBlock(candidate: SourceCandidateInput) {
  const lines = [
    `source: ${candidate.source}`,
    `url: ${candidate.url}`,
    `title: ${candidate.title ?? ''}`,
    `author: ${candidate.author ?? ''}`,
    `text: ${candidate.text}`,
    `engagement: ${JSON.stringify(candidate.engagement ?? {})}`
  ]
  const visualSummary = formatVisualSummary(candidate)
  if (visualSummary) lines.push(`visualSummary: ${visualSummary}`)
  return lines.join('\n')
}

function formatVisualSummary(candidate: SourceCandidateInput) {
  const analysis = candidate.imageAnalysis
  if (!analysis || (analysis.status !== 'success' && analysis.status !== 'partial') || !analysis.summary?.trim()) return null
  const imageDetails = analysis.images
    .map((image, index) => {
      const objects = image.notableObjects.length > 0 ? `；物件：${image.notableObjects.join('、')}` : ''
      const text = image.textDetected ? `；圖中文字：${image.textDetected}` : ''
      return `圖${index + 1}：${image.description}${objects}${text}`
    })
    .join(' / ')
  return `以下是已實際分析貼文附圖得到的視覺摘要，不是從 URL 猜測：${analysis.summary}${imageDetails ? `。${imageDetails}` : ''}`
}
