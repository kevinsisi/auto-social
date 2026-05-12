# auto-social → 社群海巡工作站

個人品牌小編 copilot。每 15 分鐘自動掃台灣社群熱點（Dcard、Threads…），用你的聲音生草稿，你審完手動發。

## 一句話描述

「現在大家在夯什麼」+「AI 用我的聲音擬好回應」+「我審完手動發」— 不送 Meta App Review，Threads 操作走 Playwright + 你自己的（建議副帳號）session。

## 目前狀態（2026-05-12）

- ✅ MVP 0.1.0 可跑（舊版「遇見好車海巡台」），UI 海巡語彙保留
- ✅ 已完成官方 API 可行性盤點（見 [`openspec/specs/mvp/spec.md`](openspec/specs/mvp/spec.md)）
- ✅ OpenSpec change `add-keyword-patrol-cards`（舊版 MVP，已實作完成）
- 🚧 **新方向 OpenSpec change：[`openspec/changes/add-social-patrol-station`](openspec/changes/add-social-patrol-station)** — Phase 0 實作中
- ✅ **Phase 0 Batch 1（rebrand + deps + DB + v1.0.0）已完成** — 改名「社群海巡工作站」、引入 `@kevinsisi/ai-core` + `playwright` + `node-cron`、新增 9 張 DB table、版本 0.1.0 → 1.0.0、`APP_VERSION` 由各 package 自己的 `package.json` 動態讀（不再硬寫常數）
- 🚧 Phase 0 Batch 2（AI backbone）進行中：已加入 KeyPool admin API、key-manager sync 骨架、GeminiClient wrapper、4 步 pipeline 骨架與 parsing/short-circuit 測試；Voice Studio 尚未開始
- ✅ 本機 Docker 可建可跑（`docker compose up -d --build`；公司網路需 `DOCKER_BUILDKIT=0`）

## Phase 0 規劃重點（社群海巡工作站）

- 改名「社群海巡工作站」，UI 海巡語彙保留，「遇見好車」品牌字串移除
- 整合 [`@kevinsisi/ai-core`](https://github.com/kevinsisi/ai-core)：`KeyPool` + `GeminiClient` + 4 步微步驟 `StepRunner`（classify → score → draft → meme）
- Voice Studio：4 軸 + 禁區 + 欣賞帳號 + 簽名口頭禪
- Trend Sources：Dcard（公開 API）+ Threads（Playwright 用副帳號 session）；雙模式（trending + keyword）
- 15 分鐘排程：trending 與 keyword 同時掃
- Settings 頁：配額、Key Pool 批次匯入、Threads Session、Sources、About
- Dashboard 兩 tab：`全網熱門` / `我的關鍵字`
- Draft Inbox：3 角度草稿；Phase 0 = `定稿 + 複製 + 貼上 Threads`（手動發），Phase 1 才開放自動 `送出`

完整規劃見 [`openspec/changes/add-social-patrol-station/`](openspec/changes/add-social-patrol-station/) 內的 `proposal.md`、`design.md`、`tasks.md`、`specs/`。

## 第一版技術棧

- **Frontend**：React + TypeScript + Vite + Tailwind CSS
- **Backend**：Node.js + Express + TypeScript
- **Database**：SQLite via `better-sqlite3`
- **AI**：Phase 0 起改用 `@kevinsisi/ai-core`（Gemini 多 key pool + retry + 微步驟）；舊版本地 `humor.ts` 規則引擎將於 Phase 0 拔除
- **Threads**：不送 Meta App Review；Phase 0 = Playwright 唯讀（search + trending feed），Phase 1 才開 publish/reply
- **排程**：node-cron 每 15 分鐘掃一輪

## 本機開發

```bash
npm install
npm run dev:server
npm run dev:client
```

常用檢查：

```bash
npm run typecheck
npm run test
npm run build
```

Server 預設：`http://localhost:4323`

Client 預設：`http://localhost:5173`

Key Pool API（Batch 2 起）：

- `GET /api/admin/keys/status`
- `POST /api/admin/keys/batch-import`，body: `{ "text": "一行一把 key，可用 # 註解" }`
- `POST /api/admin/keys/sync`，從 `KEY_MANAGER_URL/api/keys/export?trusted_only=1` 同步

安全限制：若設定 `ADMIN_TOKEN`，以上 API 需要 `Authorization: Bearer <token>`；未設定時僅允許 loopback 本機請求。

Docker 預覽：

```bash
docker compose up -d --build
```

開啟：`http://localhost:4323`

> **公司網路內 build 一定要照固定步驟跑**：完整指令 + 各步驟為什麼必要 + 常見錯誤對照表都寫在 [`CLAUDE.md` 的 "Local Docker Build — Company Network" 區塊](CLAUDE.md#local-docker-build--company-network-read-first)，AI 接手會第一眼看到。摘要：先 `docker pull node:22-bookworm-slim` → 再 `DOCKER_BUILDKIT=0 docker compose build` → `docker compose up -d`。Dockerfile 內 `LOCAL-TEST ONLY` 標記的 TLS bypass 不可進 production。

## 原官方 API 技術棧備忘

- **Meta Graph API**：Threads（`graph.threads.net`）+ Instagram Graph API
- **Token**：60-day long-lived token + 自動刷新流程
- **公開媒體儲存**：S3 / R2 / GCS / Cloudflare Images（Meta 必須能 cURL 媒體 URL）
- **排程器**：cron / 任務佇列（BullMQ 或 Cloud Tasks）— 兩個平台 API 皆無原生 `publish_at`
- **Webhook 接收端**：用於即時留言事件 → 規則或 AI 生成回覆 → 呼叫 reply API
- **App Review**：上線前必須通過 Meta 審核（每個 write scope 各自送審）

## 第一版 MVP 功能

| 功能 | 狀態 | 備註 |
|---|---|---|
| 關鍵字海巡卡 | ✅ | 保留原始關鍵字 |
| 手動 Threads 連結匯入 | ✅ | 立即產生建議 |
| Threads Web 搜尋開頁 | ✅ | 不自動登入、不自動送出 |
| AI 風格回覆建議 | ✅ | 目前為本地規則引擎 |
| 迷因/圖卡 prompt | ✅ | 尚未接真圖像生成 provider |
| 值不值得回/風險標記 | ✅ | low / medium / high |
| 自動送出回覆 | ❌ | MVP 明確不做 |
| Meta App / OAuth | ❌ | MVP 明確不做 |

## 官方 API 長期功能備忘

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
