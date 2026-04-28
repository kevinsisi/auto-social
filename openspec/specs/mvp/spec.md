# MVP 規格 — Threads / Instagram 自動化可行性報告

> 本文件僅為 **plan-before-build** 階段的可行性盤點，目的是在動工前確認哪些 MVP 功能可以靠官方 API 完成、哪些需要其他途徑或必須降級。實作細節（資料庫、佇列、UI）留到後續 OpenSpec change 提案再展開。
>
> 調查日期：2026-04-28
> 主要來源：Meta for Developers 官方文件（developers.facebook.com/docs/threads, /docs/instagram-platform）+ 第三方整理。

---

## 1. 背景與目的

`auto-social` 預期支援自動化內容發佈與互動管理，初步鎖定 **Threads** 與 **Instagram** 兩個平台。本報告回答四個問題：

1. 官方 API 能不能做到「自動發文（文字 / 圖片 / 影片）」？
2. 官方 API 能不能做到「自動回覆 / 留言管理」？
3. 官方 API 是否內建定時發文？
4. Threads 與 Instagram 是不是同一套 API？認證流程與額度怎麼算？

---

## 2. 平台 API 概覽

### 2.1 Meta Threads API（graph.threads.net）

- 公開的 Graph 風格 API，與 Instagram Graph API **共用 Meta Graph 基礎設施，但端點、OAuth flow、Token 完全分離**。
- 認證網域：`graph.threads.net`。
- 支援的內容形式：`TEXT`、`IMAGE`、`VIDEO`、`CAROUSEL`（一則 carousel 2–20 個項目）。
- 文字長度上限：500 字元（emoji 以 UTF-8 byte 數計）。
- 媒體必須放在「公開可存取」的 URL 上 — Meta 會主動 cURL 你的 URL 抓媒體；不能直接 multipart upload 二進位內容。
- 發佈是 **兩步驟流程**：
  1. `POST /{threads-user-id}/threads` 建立 media container（拿到 `creation_id`）。
  2. `POST /{threads-user-id}/threads_publish` 用 `creation_id` 真正發出。
  3. 文字貼文可用 `auto_publish_text` 旗標跳過第 2 步。
  4. 兩步驟之間 **建議至少等 30 秒**，讓 Meta 處理媒體。
- Webhooks：可訂閱即時事件（提及、回覆等）。

### 2.2 Instagram Graph API（developers.facebook.com/docs/instagram-platform）

- 服務對象：**Instagram Business 或 Creator 帳號**，且須與一個 Facebook Page 連結（採 Facebook Login for Business 流程時）。
- 兩種登入流程：
  - **Instagram Business Login**（Instagram 直接登入）。
  - **Facebook Login for Business**（透過 Facebook 商業管理平台，多帳號管理首選）。
- 支援發佈型態：Feed Post（圖 / 影片 / 輪播）、Reels、Stories。
- Reels 發佈：**官方公告為 Business 帳號才能透過 API 發佈**；技術上 API 會接受最長 15 分鐘影片，但只有 5–90 秒、9:16 比例會出現在 Reels 分頁，否則會以一般影片貼文呈現。
- 進階權限（Advanced Access）需要通過 **Business Verification**。

### 2.3 Threads ≠ Instagram（重要）

- **不是同一套 API**：端點不同、OAuth 不同、Access Token 不能共用、Rate Limit 各算各的。
- 同一個品牌要同時跨發 Threads + Instagram 時，必須做兩次完整的 OAuth、維護兩組 Token、各自呼叫各自的 publishing endpoint。

---

## 3. 認證流程

### 3.1 Threads OAuth 2.0

| 階段 | 端點 / 機制 | 有效期 |
|---|---|---|
| Authorization Code | 使用者授權後拿到 code | 1 小時、單次 |
| Short-lived Token | `POST https://graph.threads.net/oauth/access_token` 用 code 換 | 1 小時 |
| Long-lived Token | `GET /access_token`（`grant_type=th_exchange_token`，需 app secret） | **60 天** |
| Refresh | `GET /refresh_access_token`（`grant_type=th_refresh_token`） | 再延 60 天，token 須已存在 ≥ 24 小時 |

- 一旦 long-lived token 過 60 天未刷新即永久失效，必須請使用者重新授權。
- Token 交換 **必須在 server side 進行**（會用到 app secret），不可放到前端或行動 App binary。

可申請的 scope：
- `threads_basic`（必要）
- `threads_content_publish`（發文 / 回覆寫入）
- `threads_read_replies`
- `threads_manage_replies`（隱藏 / 取消隱藏 / 待審回覆）
- `threads_manage_insights`

### 3.2 Instagram Graph OAuth

- 流程透過 Facebook OAuth（Facebook Login for Business）或 Instagram Business Login。
- 同樣有 short-lived → long-lived token 模式（IG long-lived 為 60 天，可刷新）。
- 需要的 scope 大致包含 `instagram_business_basic`、`instagram_business_content_publish`、`instagram_business_manage_comments`、`instagram_business_manage_insights` 等（依授權方式略有不同）。

### 3.3 App Review（兩個平台都要）

- **生產環境** 要使用任何「寫入 / 內容發佈」scope 都需要通過 Meta App Review。
- 審核需提交螢幕錄影示範實際使用情境，每個 scope 各自送審。
- 審核期間（Development Mode）只能對 **App Owner 自己的帳號** 與 **登錄為 Tester 的帳號** 操作 — 足以做完整開發 / 整合測試。
- Instagram 的 Advanced Access 還額外要求 Business Verification。

---

## 4. 功能可行性對照表

| MVP 功能 | Threads | Instagram | 備註 |
|---|---|---|---|
| 自動發文 — 純文字 | ✅ | N/A | Threads 限 500 字元 |
| 自動發文 — 單圖 | ✅ | ✅ | 媒體必須是公開 URL |
| 自動發文 — 單影片 | ✅ | ✅ | Threads 用 `video_url` 欄位 |
| 自動發文 — 多圖 / 輪播 | ✅（2–20 項） | ✅ | |
| 自動發 Reels | N/A | ✅（Business 帳號） | 5–90 秒、9:16 才會顯示在 Reels 分頁 |
| 自動發 Stories | ❌（非原生概念） | ✅ | Threads 端只能透過第三方整合「分享 Threads 貼文到 IG Stories」 |
| 程式化「回覆貼文」 | ✅ | ✅ | Threads 用 `reply_to_id`（同樣兩步驟 container） |
| 程式化「對使用者留言自動回覆」 | ✅（你寫邏輯 + 呼叫 reply API） | ✅（comments API） | **沒有 Meta 內建 auto-responder bot**；你必須自己監聽 Webhook → 判斷 → 呼叫 reply |
| 隱藏 / 取消隱藏留言 | ✅ `manage_reply` | ✅ | Threads 只能 hide，**沒有 delete** |
| 待審回覆（pending replies） | ✅ `pending_replies` / `manage_pending_reply` | — | |
| 原生定時發文 | ❌ | ❌ | **API 沒有 `publish_at` 參數**，必須自建排程 / 任務佇列 |
| 跨平台一鍵發佈 | — | — | 無共用端點，需各自呼叫並各自維護 token |
| 取得貼文 / 帳號 Insights | ✅ `threads_manage_insights` | ✅ Insights API | |
| 訂閱即時事件 | ✅ Webhooks | ✅ Webhooks | 自動回覆功能的關鍵 |

---

## 5. 限制與額度

### 5.1 Rate Limits

- **Threads**：每個 profile 在 **滾動 24 小時內**：
  - 最多 **250 則貼文**（一個 carousel = 1 則；新貼文計入，回覆 **不計入**）。
  - 最多 **1,000 則回覆**。
- **Instagram**：每個 IG Business / Creator 帳號 **滾動 24 小時內** **100 則 API-published 貼文**（Reels + Feed + Stories 合計，carousel 算 1）。
- 此外 Meta Graph API 還有平台層級的呼叫頻率限制（Business Use Case rate limiting），需在實作時讀取回應 Header `x-business-use-case-usage` 做 backoff。

### 5.2 媒體裝載限制

- 兩個平台都要求媒體在「公開 HTTPS URL」上 — 表示我們需要：
  - 自己的物件儲存（S3 / R2 / GCS / Cloudflare Images 等）+ 公開或簽章 URL；或
  - 使用者上傳媒體後先存到我方公開儲存，再餵給 Meta。
- Meta 抓取後仍可能需要時間轉檔，**呼叫 publish 前等 ≥ 30 秒** 是文件建議的安全值。

### 5.3 Token 與帳號

- Long-lived Token 最長 60 天，必須有刷新流程，否則會在背景斷線。
- Instagram Reels 發佈僅支援 Business 帳號（依照 Meta 公告），Creator 帳號讀取/留言 OK，但 Reels 寫入不一定可用 — **若 MVP 需要支援 Creator 帳號發 Reels，需在實作前先以一個 Tester Creator 帳號實測確認**。
- Threads 端目前 **沒有「刪除回覆」端點**，只有 hide / pending approval — 若 MVP 需求包含「真刪」，必須降級成 hide 或請使用者手動操作 App。

---

## 6. MVP 設計上的關鍵推論

1. **必須自建排程器**。Threads 與 Instagram API 都沒有 `publish_at`，所以「定時發文」這件事一定是我方系統的職責（cron / 任務佇列 / scheduler service）。這是 MVP 必備元件。
2. **必須自建公開媒體儲存**。不能直接接受使用者上傳的 binary 餵給 Meta，必須先寫入到一個可被 Meta cURL 的 URL（S3/R2/GCS/CDN）。
3. **必須做 Webhook 接收端**。「自動回覆留言」沒有原生 bot，要靠 Webhook 即時收到留言事件 → 我方判斷邏輯（含 AI 生成回覆）→ 呼叫 reply API。
4. **Token 生命週期管理是必做功能**：每個連接帳號要記下 long-lived token 與到期時間，並在 ≤ 60 天內主動刷新。
5. **App Review 是上線前的硬性門檻**，建議 MVP 階段先做 Development Mode + Tester 帳號完成端到端，產品定稿後再送審；提案時程要把「Meta 審核可能 1–數週」算進去。
6. **Threads 與 Instagram 視為兩個獨立連接器**，不要共用任何 token / endpoint / quota 抽象 — 抽象層只在「貼文資料模型」共用即可。

---

## 7. 待決問題（送進下一輪 OpenSpec change 前要拍板）

- MVP 是否要同時支援 Threads + Instagram，還是先做 Threads only？
- 是否要支援 Reels？若要，是否限定 Business 帳號？
- 「自動回覆」是 (a) 規則 / 模板回覆，還是 (b) AI 生成回覆？兩者對 Webhook 接收端與成本結構差很多。
- 排程粒度：分鐘級 / 秒級？決定排程器選型（純 cron vs. 任務佇列如 BullMQ / Cloud Tasks）。
- 公開媒體儲存的選型（影響部署成本與 CDN 設定）。
- 失敗重試策略：Meta 的容器建立、發佈、Token 刷新都會有暫時性失敗，需依 `skills/integration-robustness/SKILL.md` 規定設計 backoff 與 per-item timeout。

---

## 8. 結論

- **可以做**：自動發文（文字 / 圖片 / 影片 / 輪播 / Reels）、程式化回覆、留言隱藏、Insights、Webhook 即時事件。
- **不能直接做、要靠我方補上**：定時發文（自建 scheduler）、自動回覆機器人（自建 Webhook + 邏輯）、媒體上傳（自建公開儲存）、Token 自動刷新、Threads 「真刪留言」（API 不支援，只能 hide）。
- **流程注意**：Threads 與 Instagram 各自獨立 OAuth 與 Token；正式上線前兩邊都要 Meta App Review；要使用 Advanced Access（IG）還要 Business Verification。

整體可行性 ✅。建議下一步進入 OpenSpec `propose` 階段，依「Threads only / Threads+IG」二選一界定 MVP scope，並把第 6 節的五個基礎元件（排程器、媒體儲存、Webhook 接收端、Token 管理、平台連接器抽象）列為 Phase 1 任務。

---

## 9. 來源

- [Threads API — Meta for Developers](https://developers.facebook.com/docs/threads)
- [Threads Publishing Reference](https://developers.facebook.com/docs/threads/reference/publishing/)
- [Threads Reply Management](https://developers.facebook.com/docs/threads/reply-management/)
- [Threads Get Access Tokens](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/)
- [Threads Long-Lived Tokens](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens/)
- [Threads Use Case for App Development](https://developers.facebook.com/docs/development/create-an-app/threads-use-case/)
- [Instagram Platform Documentation](https://developers.facebook.com/docs/instagram-platform/)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Instagram API with Facebook Login for Business](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram/)
- [Graph API Rate Limiting Overview](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- 第三方對照：[Postman Threads API Collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)、[Phyllo Instagram API Guide 2026](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy)、[Phyllo Reels API Guide 2026](https://www.getphyllo.com/post/a-complete-guide-to-the-instagram-reels-api)
