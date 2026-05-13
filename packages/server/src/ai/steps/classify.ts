import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import { SENTIMENT_CLASSES, type ClassifyResult, type SourceCandidateInput } from '../types.js'

export const classifySchema = z.object({
  topic: z.string().min(1),
  sensitivity: z.enum(['low', 'medium', 'high']),
  voiceFit: z.number().min(0).max(1),
  sentiment: z.enum(SENTIMENT_CLASSES as unknown as [string, ...string[]]).transform((value) => value as ClassifyResult['sentiment']),
  reason: z.string().min(1)
})

export function buildClassifyPrompt(candidate: SourceCandidateInput) {
  return `請分類這則社群候選內容，只回單一 JSON 物件，欄位：
- topic: 一句話描述主題（zh-TW）
- sensitivity: low / medium / high（high 表示政治、宗教、個人攻擊、敏感族群等高風險）
- voiceFit: 0~1，越接近 1 表示越值得用個人聲音回應
- sentiment: 從以下 7 類擇一，描述「發文者的情緒姿態」，不是主題或他人
  * anger     強烈憤怒、咒罵、攻擊性語氣（例：「操這家垃圾公司」）
  * complaint 抱怨、不滿、但比 anger 溫和（例：「又斷網了，台灣固網真的爛」）
  * help      求助、問問題、徵詢推薦（例：「有沒有人推薦台北便宜的牙醫」）
  * sarcasm   嘲諷、反諷、酸（例：「真不愧台灣之光，又漲價了」）
  * neutral   中性敘述、純資訊（例：「今天台北 28 度多雲偶陣雨」）
  * positive  開心、分享好事（例：「今天牛肉麵好吃到爆」）
  * support   鼓勵、支持、給人加油（例：「加油啊，這個社會需要你這樣的聲音」）
  每則只給一個 label，遇到混合語氣以主導語氣判斷。
- reason: 一句話說明上述判斷的依據

只回 JSON：{"topic":"...","sensitivity":"low|medium|high","voiceFit":0-1,"sentiment":"anger|complaint|help|sarcasm|neutral|positive|support","reason":"..."}

${candidateBlock(candidate)}`
}

export function parseClassify(raw: string): ClassifyResult {
  return parseJsonObject(raw, classifySchema, 'classify') as ClassifyResult
}
