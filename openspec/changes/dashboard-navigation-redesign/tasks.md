# Tasks: Dashboard Navigation Redesign

## Backend

- [ ] B1: `GET /api/cards` — SQL 加 `recentSampleCount` + `lastScanAt`
- [ ] B2: Client type `PatrolCard` 加兩個欄位；`api.ts` 不需改動（欄位直接出現）

## Frontend — 基礎

- [ ] F1: URL routing 擴充：`getDashboardTab()` 解析 `#dashboard/radar` / `#dashboard/workstation`
- [ ] F2: Tab bar 元件（desktop: header 內嵌；mobile: fixed bottom）
- [ ] F3: navigate helper 更新：`navigateTab(tab)` / `navigateCard(id)` / `navigateBack()`

## Frontend — 各 Tab

- [ ] F4: OverviewTab — KeywordStatusCard grid + NEW badge (localStorage) + AddKeywordInput
- [ ] F5: RadarTab — 搬 HotKeywordCloud，無其他變動
- [ ] F6: WorkstationTab — 搬 PostDraftPanel + AiQueuePanel + SchedulerPanel

## Frontend — 詳情頁

- [ ] F7: KeywordDetailPage — 加返回按鈕；mobile 全版面；刪除移到頁內

## 收尾

- [ ] F8: 移除舊 sidebar layout（`<aside>` 左欄）與舊主區塊 grid
- [ ] F9: `padding-bottom` 防止 mobile bottom tab bar 遮內容
- [ ] V1: 版本 bump + commit + push
