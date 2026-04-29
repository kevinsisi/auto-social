# auto-social

社群平台（Threads / Instagram）自動化發文 + 互動管理系統 — 目前處於 **plan-before-build / 可行性盤點階段**，尚未開始實作。

## 一句話描述

針對 Meta Threads 與 Instagram 兩個平台，提供自動發文（文字 / 圖片 / 影片 / 輪播 / Reels）、定時排程、Webhook 即時回覆與 Token 管理的整合服務。

## 目前狀態（2026-04-29）

- ✅ 已完成可行性盤點（見 [`openspec/specs/mvp/spec.md`](openspec/specs/mvp/spec.md)）
- ❌ 尚未進入 OpenSpec `propose` 階段
- ❌ 尚未開始實作

## 預定技術棧（待 propose 階段拍板）

- **Meta Graph API**：Threads（`graph.threads.net`）+ Instagram Graph API
- **Token**：60-day long-lived token + 自動刷新流程
- **公開媒體儲存**：S3 / R2 / GCS / Cloudflare Images（Meta 必須能 cURL 媒體 URL）
- **排程器**：cron / 任務佇列（BullMQ 或 Cloud Tasks）— 兩個平台 API 皆無原生 `publish_at`
- **Webhook 接收端**：用於即時留言事件 → 規則或 AI 生成回覆 → 呼叫 reply API
- **App Review**：上線前必須通過 Meta 審核（每個 write scope 各自送審）

## MVP 預定功能

| 功能 | Threads | Instagram | 備註 |
|---|---|---|---|
| 自動發文（文字 / 圖 / 影片 / 輪播） | ✅ | ✅ | Threads 限 500 字元 |
| Reels 發佈 | N/A | ✅（Business 帳號） | 5–90 秒、9:16 才上 Reels 分頁 |
| Stories | ❌ | ✅ | Threads 無原生概念 |
| 程式化回覆 | ✅ | ✅ | Threads 兩步驟 container |
| 自動回覆留言 | ✅（自建邏輯） | ✅ | Meta 沒有內建 auto-responder |
| 隱藏留言 | ✅（hide-only） | ✅ | Threads 無 delete 端點 |
| 定時發文 | ❌ API 不提供 | ❌ API 不提供 | 必須自建 scheduler |
| Insights / Webhook | ✅ | ✅ | |

## 平台限制重點

- **Threads ≠ Instagram**：endpoint、OAuth、Access Token、Rate Limit 全部分離
- **Rate Limit**：Threads 每 24h 250 貼文 / 1000 回覆；Instagram 每 24h 100 publish
- **媒體必須是公開 HTTPS URL**，Meta 主動 cURL 拉取，不接受 multipart binary
- **publish 前等 ≥ 30 秒** 讓 Meta 完成轉檔
- **Long-lived Token 60 天**，過期須使用者重新授權

## 部署方式

尚未決定。預計：
- 公開媒體儲存（S3/R2 等）
- 排程器（任務佇列）
- Webhook 端點（公開 HTTPS）
- Token 加密儲存

## URL

- Repo：<https://github.com/kevinsisi/auto-social>

## 進一步資訊

完整可行性報告與限制細節：[`openspec/specs/mvp/spec.md`](openspec/specs/mvp/spec.md)。
