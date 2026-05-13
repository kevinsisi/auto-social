import { z } from 'zod'
import { parseJsonObject } from '../json.js'
import { candidateBlock } from '../prompt-builder.js'
import type { ScamResult, SourceCandidateInput } from '../types.js'

export const scamDetectSchema = z.object({
  scamSignal: z.enum(['none', 'suspect', 'likely']),
  reasons: z.array(z.string().min(1).max(60))
})

export function buildScamDetectPrompt(candidate: SourceCandidateInput) {
  return `判斷這則貼文是否為詐騙、釣魚、或可疑的性交易邀約。只回單一 JSON：
{"scamSignal":"none|suspect|likely","reasons":["短句1","短句2"]}

判斷信號（看到 1 條 → suspect，看到 2 條以上 → likely）：
1. 性暗示邀約：「兼差」「外約」「全套」「半套」「茶水價目」「LINE: xxx 約」「不戴不負責」「可長期」「禮物」+ 金額
2. 私訊誘導陌生人：「私訊我」「LINE / WeChat / TG ID 是 ...」「加我好友再聊」搭配可疑情境
3. 假投資 / 假交友：「報明牌」「保證獲利」「老師帶單」「我月入 X 萬」「跟我學賺錢」
4. 釣魚連結：bit.ly / lihi / tinyurl / 短網域 / 看起來像官方但網域怪
5. 制式話術：多則同帳號高頻發類似內容、回覆都類似罐頭、頭像/介紹過度乾淨
6. 急迫感 + 金錢：「最後機會」「名額有限」「先匯款」「保留位置」

reasons 用繁體中文短句具體描述觸發的信號（每句 ≤ 30 字，不要照抄原文）；
scamSignal=none 時 reasons 必須為空陣列 []；
scamSignal=suspect 至少 1 條 reason；
scamSignal=likely 至少 2 條 reason。
sentiment 與葉配判斷與本判斷無關，三者各自獨立。

${candidateBlock(candidate)}`
}

export function parseScamDetect(raw: string): ScamResult {
  const parsed = parseJsonObject(raw, scamDetectSchema, 'scam-detect')
  if (parsed.scamSignal === 'none' && parsed.reasons.length > 0) {
    return { scamSignal: 'none', reasons: [] }
  }
  return parsed
}
