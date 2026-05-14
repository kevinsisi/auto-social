# Dashboard Navigation Redesign

## Why

目前 dashboard 把雷達雲、關鍵字監控、草稿、AI Queue、排程、貼文觀察全部堆在同一個 scroll，
手機上幾乎不可用，iMac 上資訊密度也過高、沒有層次感。

用戶使用情境：手機 + iMac，兩個尺寸都要能順暢操作。

## What Changes

### 導航結構

從「sidebar + 主區塊」改為「Tab bar + 下鑽詳情頁」：

- **Tab 1：概覽** (`#dashboard`) — 關鍵字狀態 grid，一眼看到哪些有新東西
- **Tab 2：雷達** (`#dashboard/radar`) — 熱門關鍵字雲 + 掃描
- **Tab 3：工作站** (`#dashboard/workstation`) — 草稿 + AI Queue + 排程狀態
- **詳情頁** (`#dashboard/card/{id}`) — 單一關鍵字的完整風向觀察（已有 URL routing）

Settings 維持獨立頂層頁。

### Desktop layout

Header 內嵌 Tab bar（概覽 / 雷達 / 工作站 / Settings），取代現有的 Dashboard / Settings 兩個按鈕。

### Mobile layout

底部固定 Tab bar（4 個 tab），內容區全版面。
詳情頁 = 全螢幕，有 ← 返回按鈕回到概覽。

### 概覽 Tab 新功能

- 關鍵字以 **grid** 呈現（desktop 3欄、tablet 2欄、mobile 2欄）
- 每張卡顯示：關鍵字名稱、24h 樣本數、主情緒顏色、上次掃描時間、NEW badge
- **NEW badge**：比上次開這張卡多了幾則，用 localStorage 記錄 `{ [cardId]: lastViewedCount }`
- 開啟詳情頁時更新 localStorage 清除 badge
- 新增關鍵字的 input 整合在概覽頁底部，不另開 form

### 工作站 Tab

把現有的 PostDraftPanel、AiQueuePanel、SchedulerPanel 搬過來，
從概覽頁移除，讓概覽頁專注在關鍵字狀態。

### Backend 變更

`GET /api/cards` 回傳每張卡多加：
- `recentSampleCount: number` — 過去 24h 候選樣本數
- `lastScanAt: string | null` — 最後一次掃描完成時間

讓概覽頁一次 API call 取得所有卡片的狀態，不需要逐一打 observation endpoint。

## Confirmed Design Decisions

| 決策 | 結論 |
|------|------|
| NEW badge 定義 | 比上次開卡時多了 N 則（localStorage delta） |
| 草稿/Queue/排程 | 獨立「工作站」tab，從概覽移除 |
| 關鍵字數量 | 10–30，grid layout 合適 |
| 雷達詞點擊行為 | 加入監控 + 自動出勤（維持現有行為） |
| 平台 | 手機 + iMac，兩個都要好用 |

## Capabilities

### New Capabilities

- `dashboard-nav`: Tab bar 導航（desktop header tabs + mobile bottom tabs），URL-routed

### Modified Capabilities

- `keyword-patrol-cards`: 概覽 grid 取代 sidebar list；詳情頁加返回按鈕
- API `GET /api/cards`: 加 `recentSampleCount` + `lastScanAt`

## Impact

- Frontend: `main.tsx` 大幅重構，拆出 Tab bar、OverviewTab、RadarTab、WorkstationTab 元件
- Backend: `observe.ts` 或 cards route 擴充兩個欄位
- DB: 不需要 schema 變更（`recentSampleCount` 從現有 candidates 表計算）
- URL routing: 已有 `#dashboard/card/{id}`，補上 `/radar` `/workstation`
