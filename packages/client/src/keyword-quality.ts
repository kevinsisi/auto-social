export type KeywordQualityLevel = 'good' | 'ok' | 'poor'

export type KeywordQuality = {
  level: KeywordQualityLevel
  reasons: string[]
  suggestions: string[]
}

const UI_NOISE_TERMS = new Set([
  '轉發', '分享', '轉發分享', '留言', '回覆', '按讚', '讚', '追蹤', '貼文', '通知', '更多', '探索', '搜尋',
  'repost', 'share', 'like', 'comment', 'follow', 'threads', 'thread'
])

const BROAD_TERMS = new Set([
  '生活', '台灣', '日常', '推薦', '分享文', '問題', '閒聊', '新聞', '熱門', '社群', '心情', '工作', '人生',
  'ai', 'car', 'cars', 'f1'
])

const SUGGESTION_MAP: Array<{ match: RegExp; suggestions: string[] }> = [
  { match: /轉發|分享|按讚|留言|回覆|互動/, suggestions: ['社群互動', '內容擴散', 'Threads 演算法', '貼文分享率'] },
  { match: /豪車|超跑|車/i, suggestions: ['豪車貸款', '超跑交車', '超跑保養', '二手超跑'] },
  { match: /法拉利|ferrari/i, suggestions: ['法拉利 849', '法拉利 F1', 'Ferrari Testarossa', '法拉利交車'] },
  { match: /ai|人工智慧/i, suggestions: ['AI 小編', 'AI 內容創作', 'AI 圖片生成', 'AI 自動化'] },
  { match: /成功|有錢|財富/, suggestions: ['創業收入', '財富自由', '高收入職涯', '成功人士生活'] }
]

export function evaluateKeywordQuality(keyword: string): KeywordQuality {
  const value = keyword.trim().normalize('NFKC')
  if (!value) return { level: 'ok', reasons: [], suggestions: [] }

  const normalized = value.replace(/\s+/g, '').toLowerCase()
  const reasons: string[] = []
  const suggestions = new Set<string>()

  if (normalized.length < 2) reasons.push('太短，容易抓到無關內容。')
  if (value.length > 18 || /[，,。！？!?]/.test(value)) reasons.push('看起來像句子，建議拆成 1 到 3 個具體主題詞。')
  if (UI_NOISE_TERMS.has(normalized)) reasons.push('這很像 Threads 介面或互動文字，不像可海巡的主題。')
  if (BROAD_TERMS.has(normalized)) reasons.push('這個詞太泛，會抓到很多不相關貼文。')
  if (/^#/.test(value) || (value.match(/#/g)?.length ?? 0) >= 2) reasons.push('hashtag 可以保留一個，但不要一次堆太多。')
  if (/^(有人知道|求推薦|想問|請問)/.test(value)) reasons.push('這比較像發問句開頭，建議改成問題背後的主題。')

  for (const entry of SUGGESTION_MAP) {
    if (!entry.match.test(value)) continue
    for (const suggestion of entry.suggestions) suggestions.add(suggestion)
  }

  if (suggestions.size === 0 && reasons.length > 0) {
    suggestions.add(`${value} 台灣`)
    suggestions.add(`${value} 費用`)
    suggestions.add(`${value} 經驗`)
  }

  return {
    level: reasons.length >= 2 || UI_NOISE_TERMS.has(normalized) ? 'poor' : reasons.length === 1 ? 'ok' : 'good',
    reasons,
    suggestions: [...suggestions].filter((suggestion) => suggestion !== value).slice(0, 4)
  }
}
