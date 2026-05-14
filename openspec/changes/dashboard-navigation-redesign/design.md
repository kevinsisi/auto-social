# Design: Dashboard Navigation Redesign

## URL Routing

```
#dashboard              → 概覽 tab (default)
#dashboard/radar        → 雷達 tab
#dashboard/workstation  → 工作站 tab
#dashboard/card/{id}    → 關鍵字詳情（desktop: 右欄顯示；mobile: 全頁）
#settings               → Settings (不變)
#settings/{section}     → Settings section (不變)
```

`getDashTabFromHash()` 從 hash 解析 tab：
- `#dashboard/card/...` → tab = 'overview'
- `#dashboard/radar`    → tab = 'radar'
- `#dashboard/workstation` → tab = 'workstation'
- else                  → tab = 'overview'

`onHashChange` 每次都 `setSelectedId(getDashboardCardId())` — null 時清除 detail view。

## Component Tree

```
App
├── Header (full width, sticky)
│   ├── Logo / Title
│   └── DesktopTabBar (概覽 | 雷達 | 工作站 | Settings)  [hidden on mobile]
├── Content (px-6, no max-width — fills full viewport)
│   ├── RadarTab         (tab === 'radar', full width)
│   ├── WorkstationTab   (tab === 'workstation', full width)
│   └── OverviewTab      (tab === 'overview')
│       ├── [desktop sm:] Split layout
│       │   ├── Sidebar aside (w-72 xl:w-80, shrink-0)
│       │   │   ├── DesktopKeywordItem × N  (selected: signal border)
│       │   │   └── AddKeywordForm (compact)
│       │   └── Main panel (flex-1)
│       │       ├── KeywordObservationPanel  (selectedId != null)
│       │       └── Placeholder              (selectedId == null, min-h full)
│       └── [mobile sm:hidden] Page-based
│           ├── KeywordDetailPage  (selectedId != null)
│           │   ├── BackButton (→ #dashboard)
│           │   ├── KeywordObservationPanel
│           │   └── DeleteCardButton
│           └── OverviewTab grid  (selectedId == null)
│               ├── KeywordStatusCard × N  (2-col grid)
│               └── AddKeywordInput
└── SettingsPage  (page === 'settings')
MobileTabBar (fixed bottom, sm:hidden)
```

## Desktop Split Layout

No `max-w-*` constraint — fills the full viewport width.

```
┌─────────────────────────────────────────────────────────────────┐
│  SOCIAL PATROL   社群海巡工作站        [概覽][雷達][工作站] Settings v1.x.x │
├──────────────────────────┬──────────────────────────────────────┤
│  台灣            +210    │  KEYWORD OBSERVATION                 │
│  皮克敏          +139    │  台灣 風向                            │
│  一個人          +295    │  [Threads 出勤海巡]                   │
│  AI             +1092   │  情緒條 / 樣本統計                    │
│  ...                     │  HIGH-ENGAGEMENT HIGHLIGHTS          │
│                          │  ...                                 │
│  ┌新增關鍵字─────┐        │                                      │
│  │ input  [加入] │        │                                      │
│  └──────────────┘        │                                      │
└──────────────────────────┴──────────────────────────────────────┘
```

Desktop auto-select: `loadCards()` 在桌面版（`window.innerWidth >= 640`）且無 hash cardId 時，自動 `selectCard(cards[0].id)`，確保右欄開啟就有內容。

## Desktop Tab Bar

位置：Header 右側。

```
[概覽]  [雷達]  [工作站]  |  [Settings]  v1.x.x
```

Active tab：`bg-asphalt text-paper`
概覽 tab 在 desktop split layout 時保持 active（不因 selectedId 影響）。

## Mobile Tab Bar

固定在底部，`position: fixed; bottom: 0; sm:hidden`。
Content area 加 `pb-24 sm:pb-6` 避免被蓋住。

```
┌──────────────────────────┐
│   概覽    雷達    工作站   │  ← active 用 signal 色 border-t
└──────────────────────────┘
```

## DesktopKeywordItem

```
┌──────────────────────────────┐
│  台灣                  +210  │  ← signal border 高亮選中
│  1860 則 · 剛剛           ✕  │
└──────────────────────────────┘
```

選中狀態：`border-signal bg-signal/5 shadow-[3px_3px_0_#ff4e00]`
未選中：`border-asphalt bg-paper`

## KeywordStatusCard（Mobile Only）

```
┌──────────────────────────────┐
│  台灣                   +210 │  ← NEW badge（橘色圓角數字）
│  1860 則  ·  2 分鐘前        │
└──────────────────────────────┘
```

2-col grid（mobile），click → `navigate('dashboard/card/{id}')`

NEW badge：
```typescript
const VC_KEY = 'asc:vc'
// stored: Record<cardId, lastViewedCount>
// badge = max(0, card.recentSampleCount - stored[card.id] ?? 0)
// mark viewed: stored[card.id] = card.recentSampleCount
```

## Backend: GET /api/cards 擴充

```sql
SELECT c.*,
  COUNT(ca.id) AS recent_sample_count,
  MAX(pr.completed_at) AS last_scan_at
FROM patrol_cards c
LEFT JOIN candidates ca
  ON ca.card_id = c.id
  AND ca.created_at >= datetime('now', '-24 hours')
LEFT JOIN patrol_runs pr
  ON pr.card_id = c.id AND pr.status = 'completed'
GROUP BY c.id
ORDER BY c.updated_at DESC
```

## Responsive Breakpoints

- `< sm` (640px) — mobile: 2欄 grid, bottom tab bar, full-page detail
- `sm+` (640px+) — desktop: split layout (sidebar + observation panel), header tab bar
