# auto-social → 社群海巡工作站

個人品牌小編 copilot。每 15 分鐘自動掃台灣社群熱點（Dcard、Threads…），用你的聲音生草稿，你審完手動發。

## 一句話描述

「現在大家在夯什麼」+「AI 用我的聲音擬好回應」+「我審完手動發」— 不送 Meta App Review，Threads 操作走 Playwright + 你自己的（建議副帳號）session。

## 目前狀態（2026-05-13）

- ✅ Production：`https://social.sisihome.org`，目前文件對齊版本 `1.2.35`
- ✅ MVP 0.1.0 可跑（舊版「遇見好車海巡台」），UI 已轉為「社群海巡工作站」
- ✅ 已完成官方 API 可行性盤點（見 [`openspec/specs/mvp/spec.md`](openspec/specs/mvp/spec.md)）
- ✅ OpenSpec change `add-keyword-patrol-cards`（舊版 MVP，已實作完成）
- 🚧 **新方向 OpenSpec change：[`openspec/changes/add-social-patrol-station`](openspec/changes/add-social-patrol-station)** — Phase A1 觀察站 MVP 已實作
- ✅ **Phase A1（觀察站 + 訓練起步）已完成** — 點關鍵字 → 看到該關鍵字在 Threads 的「主要情緒風向」+ 貼文清單 + 每則 AI 建議留言 + 👍像我 / 👎不像 / ✏️改寫 訓練回饋；獨立葉配偵測（none / suspect / likely 加 reasons[]）；throttle.ts kill switch + daily quota + jitter 真的可擋
- ✅ **Phase A1.5（觀察站持續強化）** — 詐騙偵測（性暗示邀約 / 私訊誘導 / 假投資 / 釣魚連結 / 制式話術 / 急迫感+金錢）獨立維度；SQLite-backed AI 任務 queue + single-flight worker（取代之前 fire-and-forget，避免 quota 瞬間爆掉）；Dashboard 上 AI 工作站 widget；貼文 4 個獨立計數 tile（讚/留言/轉發/分享）+ K/M 縮寫；重點貼文 highlights 按互動分（讚+留言×3+轉發×5+分享×2 ≥ 50）獨立區塊；圖片 + **影片**多媒體縮圖（▶ 影片覆蓋）；URL canonical /post/<id>（自動去重 /media）；Taiwan-first 過濾（丟英/日/韓主導貼文）；草稿全面禁 emoji + 禁開頭話術 + 台灣 Threads 真人口頭禪 prompt 重寫
- ✅ **Phase A2a（發文發想 MVP）** — Queue-backed `compose_post` 正式啟用：Dashboard 可手動觸發「生一篇發文靈感」，worker 會根據最近 24h 雷達詞與真實 Threads 候選生成一則原創貼文草稿，寫入 `post_drafts`，可直接複製貼文與查看圖片提示詞；仍維持 human-gated，不自動發布
- ✅ **關鍵字自動海巡已補上** — server 啟動後會在 `Asia/Taipei` 以 `*/15 * * * *` 每 15 分鐘掃一次所有 keyword cards，並以 no-overlap guard 避免重疊執行；Dashboard 會顯示最近一次自動海巡狀態
- ✅ **觀察樣本新鮮度 + 建議詞** — Threads 搜尋與觀察站都會排除超過一年以前的已知貼文；觀察站會從目前樣本抽出建議關鍵詞，但只顯示 chip，點擊後才加入監控並出勤，不會自動擴張
- ✅ **配額 fallback + 防連點回饋** — Threads Playwright search 每日 quota 用完時，keyword scan 會改走 Bing-first / Google-second 的 `site:threads.net OR site:threads.com` 備援；UI 按下海巡後會立即顯示「海巡中」並鎖住按鈕，避免手機連點重複送出
- ✅ **Settings 導航 + Threads quota 操作** — Settings 頁面提供明確「回儀表板」入口；Threads 設定可查看 search quota 今日用量、調整每日上限、清除今日 search 用量，預設 search 上限為 2000/day，避免 200/day 卡死海巡
- ✅ **fallback 搜尋可靠度強化** — fallback 已改成 Bing 優先、Google 次要；可解析 Bing `/ck/a?...&u=a1...` redirect，並區分搜尋源被 Bing/Google challenge 擋住與真的沒結果
- ✅ Phase 0 Batch 1+2 基礎：`@kevinsisi/ai-core` + `playwright` + `node-cron`、KeyPool admin API、5 步 AI pipeline（classify + sponsored + scam + score + draft）、Threads Playwright 唯讀搜尋優先 + `site:threads.net OR site:threads.com` fallback、Settings 路由
- 🚧 Phase A2 待辦：發文發想 composer（4h cron 從熱門關鍵字產文 → Gemini 生圖 → 半自動發布）、進貼文內頁抓留言、留言情緒、Voice Studio 整頁、voice profile 從 feedback 進化
- ✅ Threads session 已支援電腦本機登入 helper：`npm run threads:login` 產生 `data/threads-storage-state.json`，Settings 可上傳並加密保存
- ✅ Production 已驗證 Threads Playwright 雷達可抓真實貼文候選，`/api/radar/trends` 讀最近 persisted candidates，不使用罐頭詞
- ✅ 本機 Docker 可建可跑（`docker compose up -d --build`；公司網路需 `DOCKER_BUILDKIT=0`）

## Phase 0 規劃重點（社群海巡工作站）

- 改名「社群海巡工作站」，UI 海巡語彙保留，「遇見好車」品牌字串移除
- 整合 [`@kevinsisi/ai-core`](https://github.com/kevinsisi/ai-core)：`KeyPool` + `GeminiClient` + 4 步微步驟 `StepRunner`（classify → score → draft → meme）
- Voice Studio：4 軸 + 禁區 + 欣賞帳號 + 簽名口頭禪
- Trend Sources：Dcard（公開 API）+ Threads（Playwright 用副帳號 session）；雙模式（trending + keyword）
- 15 分鐘排程：trending 與 keyword 同時掃
- Settings 頁：配額、Key Pool 批次匯入、Threads Session、Sources、About
- Dashboard：熱門關鍵字雲 + 關鍵字監控清單；後續擴成兩 tab：`全網熱門` / `我的關鍵字`
- Draft Inbox：3 角度草稿；Phase 0 = `定稿 + 複製 + 貼上 Threads`（手動發），Phase 1 才開放自動 `送出`

完整規劃見 [`openspec/changes/add-social-patrol-station/`](openspec/changes/add-social-patrol-station/) 內的 `proposal.md`、`design.md`、`tasks.md`、`specs/`。

## 第一版技術棧

- **Frontend**：React + TypeScript + Vite + Tailwind CSS
- **Backend**：Node.js + Express + TypeScript
- **Database**：SQLite via `better-sqlite3`
- **AI**：Phase 0 起改用 `@kevinsisi/ai-core`（Gemini 多 key pool + retry + 微步驟）；舊版本地 `humor.ts` 規則引擎將於 Phase 0 拔除
- **Threads**：不送 Meta App Review；Phase 0 = Playwright 唯讀（search + trending feed），Phase 1 才開 publish/reply
- **排程**：node-cron 每 15 分鐘掃一輪

重要限制：產品核心目標是 Threads。其他平台不能替代 Threads 海巡；目前 `Threads 出勤海巡` 會先嘗試 Playwright 開 Threads 搜尋頁，失敗時才退回 `site:threads.net OR site:threads.com` fallback，用來確保仍只收 Threads 連結。

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

Threads Session / Playwright：

- `AUTO_SOCIAL_SESSION_KEY`：選填但建議設定；用於 AES-256-GCM 加密保存 Threads `storageState`，可用 `openssl rand -hex 32` 產生。
- `KEY_MANAGER_URL`：選填；不設定時 `從 key-manager 同步` 會停用，但 Settings 仍可手動貼 Gemini keys。
- 本機登入：執行 `npm run threads:login`，完成 Instagram / Threads 驗證並進入 Threads 頁面後，工具會輸出 `data/threads-storage-state.json`。
- Settings → Threads Session 可貼上 Playwright `storageState` JSON；保存後 Playwright 搜尋會優先帶 session。
- `Threads 出勤海巡`：先跑 Playwright 唯讀搜尋，失敗自動退回 `site:threads.net OR site:threads.com` 搜尋備援。
- `GET /api/scheduler/status`：查看 keyword 自動海巡是否在跑、上次執行時間、最近一次掃了幾張卡與新增幾筆。

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

已加入 GitHub Actions CI/CD，目標是 amd64 Docker 主機：

- `CI`：PR / main push 執行 `npm ci`、`typecheck`、`test`、`build`
- `Build and Push Docker Image`：main push 後 build `linux/amd64` image，推到 `kevin950805/auto-social:latest` 與 commit SHA tag
- `Deploy to amd64 Server via Tailscale`：Docker image build 成功後，透過 Tailscale + SSH 同步 `deploy/docker-compose.yml` 到主機並部署 SHA tag
- Domain：`https://social.sisihome.org`

GitHub secrets 需要設定：

- `DOCKERHUB_TOKEN`
- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `DEPLOY_SERVER_IP`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`

選填：`DEPLOY_USER`，未設定時預設使用 `kevin`。

目標主機的 `${DEPLOY_PATH}/.env` 可保留站台設定；workflow 只會更新 `IMAGE_TAG`。常用值：

```bash
HOST_PORT=4323
CORS_ORIGIN=https://social.sisihome.org
ADMIN_TOKEN=change-me
KEY_MANAGER_URL=
AUTO_SOCIAL_SESSION_KEY=change-me-with-openssl-rand-hex-32
```

健康檢查：`http://<DEPLOY_SERVER_IP>:4323/api/health`。

## URL

- Repo：<https://github.com/kevinsisi/auto-social>

## 進一步資訊

完整可行性報告與限制細節：[`openspec/specs/mvp/spec.md`](openspec/specs/mvp/spec.md)。
