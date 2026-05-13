import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { SourceCandidateInput, SponsoredResult } from '../types.js'

export const sponsoredDetectSchema = z.object({
  sponsoredSignal: z.enum(['none', 'suspect', 'likely']),
  reasons: z.array(z.string().min(1).max(60))
})

export function buildSponsoredDetectPrompt(candidate: SourceCandidateInput) {
  return `判斷這則貼文是否為「葉配 / 業配」（廣告偽裝成自然發文）。只回單一 JSON：
{"sponsoredSignal":"none|suspect|likely","reasons":["短句1","短句2"]}

判斷信號（看到 1 條 → suspect，看到 2 條以上 → likely）：
1. 明顯品牌植入 + 過度正向、沒缺點描述
2. 用語過度乾淨、像 PR 稿、賣點重複
3. 隱性 CTA：「私訊我」「下單連結在 bio」「優惠碼」「折扣碼」「點連結」
4. 明示廣告 hashtag：#廣告 #ad #sponsored #業配 #合作
5. 大量品牌名重複（同一段內 3 次以上同一品牌）

reasons 用繁體中文短句具體描述觸發的信號（每句 ≤ 30 字，不要照抄原文）；
sponsoredSignal=none 時 reasons 必須為空陣列 []；
sponsoredSignal=suspect 至少 1 條 reason；
sponsoredSignal=likely 至少 2 條 reason。
sentiment（情緒）與本判斷無關，任何情緒都可能是葉配。

${candidateBlock(candidate)}`
}

export function parseSponsoredDetect(raw: string): SponsoredResult {
  const parsed = parseJsonObject(raw, sponsoredDetectSchema, 'sponsored-detect')
  if (parsed.sponsoredSignal === 'none' && parsed.reasons.length > 0) {
    return { sponsoredSignal: 'none', reasons: [] }
  }
  return parsed
}
