import type { CandidateAnalysis, ReplySuggestion, RiskLevel } from './types.js'

const BLOCKED_TERMS = ['低能', '白癡', '智障', '垃圾', '廢物', '去死', '殺', '人肉', '地址', '電話']

export function isForbiddenDraft(text: string) {
  return BLOCKED_TERMS.some((term) => text.includes(term))
}

export function getRiskLevel(input: string): RiskLevel {
  const text = input.toLowerCase()
  if (text.includes('告') || text.includes('詐騙') || text.includes('爛') || text.includes('吵')) {
    return 'high'
  }
  if (text.includes('貴') || text.includes('坑') || text.includes('不爽') || text.includes('靠')) {
    return 'medium'
  }
  return 'low'
}

export function generateAnalysis(candidateId: string, keyword: string, url: string, title: string, excerpt: string): CandidateAnalysis {
  const context = [title, excerpt, url].filter(Boolean).join(' ')
  const hasReadableContent = Boolean(title.trim() || excerpt.trim())
  const riskLevel = getRiskLevel(context)
  const worthReplying = riskLevel !== 'high'
  const riskNote = riskLevel === 'high'
    ? '這則回了可能吵起來，建議先觀望或只留資訊型回覆。'
    : riskLevel === 'medium'
      ? '可以回，但要用自嘲和資訊收斂火力。'
      : '適合輕鬆接話，順手帶回工作站。'

  if (!hasReadableContent) {
    return {
      candidateId,
      summary: '目前只有連結，還沒有可讀內容；先開 Threads 確認原文，避免我們在這邊通靈。',
      worthReplying: false,
      replyAngle: '內容不足，建議先開頁確認，再回來補摘錄產生建議。',
      riskLevel: 'medium',
      riskNote: '沒有原文時不產生回覆，避免把 Threads 當許願池。',
      imageIdea: `一張「海巡看到連結但還沒看到內容」的自嘲圖卡。`,
      memePrompt: `搞笑迷因圖卡：小編拿放大鏡看一串 Threads 連結，文字「不是不能回，是我們還沒看到原文」。不要攻擊真人。`,
      suggestions: []
    }
  }

  const baseNormal = `這題先讓海巡隊來幫你看看。${keyword} 這種事不要靠許願，靠一點點功課跟一點點緣分。`
  const baseSpicy = `笑死，證據追不上結論啦。不過沒關係，我們也是常常被現實教育，這題慢慢拆。`

  const suggestions: ReplySuggestion[] = [
    makeSuggestion(candidateId, 'normal', '普通', baseNormal, riskLevel, riskNote),
    makeSuggestion(candidateId, 'spicy', '比較酸', baseSpicy, riskLevel, riskNote)
  ].filter((suggestion) => !isForbiddenDraft(suggestion.text))

  return {
    candidateId,
    summary: excerpt || `和「${keyword}」相關的 Threads 候選連結，內容需要人工確認後再互動。`,
    worthReplying,
    replyAngle: worthReplying ? '用自嘲開場，補一點觀察，最後輕輕收尾。' : '高風險討論，除非能提供客觀資訊，否則不建議開戰。',
    riskLevel,
    riskNote,
    imageIdea: `一張「${keyword} 海巡中」的短梗圖，畫面像社群小編半夜拿放大鏡看貼文。`,
    memePrompt: `搞笑迷因圖卡，上下對比：上方「以為熱點靠感覺」，下方「海巡小編：靠，還是讓我看一下原文」。風格像台灣社群小編，短 punchline，不攻擊真人。`,
    suggestions
  }
}

function makeSuggestion(
  candidateId: string,
  tone: ReplySuggestion['tone'],
  label: ReplySuggestion['label'],
  text: string,
  riskLevel: RiskLevel,
  riskNote: string
): ReplySuggestion {
  return {
    id: `${candidateId}-${tone}`,
    candidateId,
    tone,
    label,
    text,
    riskLevel,
    riskNote
  }
}
