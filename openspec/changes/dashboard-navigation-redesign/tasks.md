# Tasks: Dashboard Navigation Redesign

## Backend

- [x] B1: `GET /api/cards` — SQL 加 `recentSampleCount` + `lastScanAt`
- [x] B2: Client type `PatrolCard` 加兩個欄位；`api.ts` 不需改動（欄位直接出現）

## Frontend — 基礎

- [x] F1: URL routing 擴充：`getDashboardTab()` 解析 `#dashboard/radar` / `#dashboard/workstation`
- [x] F2: Tab bar 元件（desktop: header 內嵌；mobile: fixed bottom）
- [x] F3: navigate helper 更新：`navigateTab(tab)` / `navigateCard(id)` / `navigateBack()`

## Frontend — 各 Tab

- [x] F4: OverviewTab — KeywordStatusCard grid + NEW badge (localStorage) + AddKeywordInput
- [x] F5: RadarTab — 搬 HotKeywordCloud，無其他變動
- [x] F6: WorkstationTab — 搬 PostDraftPanel + AiQueuePanel + SchedulerPanel

## Frontend — 詳情頁

- [x] F7: KeywordDetailPage — 加返回按鈕；mobile 全版面；刪除移到頁內

## 收尾

- [x] F8: 移除舊 sidebar layout（`<aside>` 左欄）與舊主區塊 grid
- [x] F9: `padding-bottom` 防止 mobile bottom tab bar 遮內容
- [x] V1: 版本 bump + commit + push (1.2.18 → 1.2.19)

## Bug Fix

- [x] BF1: `onHashChange` 只在 cardId 非 null 時更新 selectedId → hash 改變後 detail 頁不清除（1.2.19 修正）
