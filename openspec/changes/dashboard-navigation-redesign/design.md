# Design: Dashboard Navigation Redesign

## URL Routing

```
#dashboard              → 概覽 tab (default)
#dashboard/radar        → 雷達 tab
#dashboard/workstation  → 工作站 tab
#dashboard/card/{id}    → 關鍵字詳情頁
#settings               → Settings (不變)
#settings/{section}     → Settings section (不變)
```

`getDashboardTab()` 從 hash 解析 tab：
- `#dashboard/card/...` → tab = 'overview' (detail overlay)
- `#dashboard/radar`    → tab = 'radar'
- `#dashboard/workstation` → tab = 'workstation'
- else                  → tab = 'overview'

## Component Tree

```
App
├── Header
│   ├── Logo / Title
│   └── DesktopTabBar (概覽 | 雷達 | 工作站 | Settings)
├── DashboardPage  (page === 'dashboard')
│   ├── OverviewTab      (tab === 'overview', no card selected)
│   │   ├── KeywordGrid
│   │   │   └── KeywordStatusCard × N
│   │   └── AddKeywordInput
│   ├── RadarTab         (tab === 'radar')
│   │   └── HotKeywordCloud (現有元件)
│   ├── WorkstationTab   (tab === 'workstation')
│   │   ├── PostDraftPanel (現有)
│   │   ├── AiQueuePanel   (現有)
│   │   └── SchedulerPanel (現有)
│   └── KeywordDetailPage  (selectedId != null)
│       ├── BackButton (→ #dashboard)
│       ├── KeywordObservationPanel (現有)
│       └── DeleteCardButton
└── SettingsPage  (page === 'settings', 不變)
    └── MobileTabBar (底部, 僅 mobile)
```

## Desktop Tab Bar

位置：Header 右側，取代現有 Dashboard / Settings 兩顆按鈕。

```
[概覽]  [雷達]  [工作站]  |  [Settings]
```

Active tab：`bg-asphalt text-paper`
Inactive：`bg-paper border-asphalt`
Settings 跟 tab 視覺上稍做區隔（pipe 分隔）。

## Mobile Tab Bar

固定在底部，`position: fixed; bottom: 0`。
Content area 加 `padding-bottom` 避免被蓋住。

```
┌──────────────────────────────┐
│  概覽   雷達   工作站   設定  │
│   ⬜     📡     🛠      ⚙    │
└──────────────────────────────┘
```

Icon 用文字符號即可（符合現有 no-emoji 原則，改用 label-only 或簡單符號）。
Active tab 用 `border-t-2 border-signal` 頂線 + signal 色文字。

## KeywordStatusCard

```
┌──────────────────────────────┐
│  台灣                   ③   │  ← NEW badge (橘色圓角數字)
│                              │
│  ■■■■■░░░░░  中立           │  ← 情緒顏色長條 (mini)
│  32 則  ·  2h ago           │
└──────────────────────────────┘
```

- 整張卡可點 → `navigate('dashboard/card/{id}')`
- 刪除 ✕ 保留在卡片右上角（hover/長按顯示）
- 無 classifiedSamples → 情緒區塊顯示「待判讀」灰色
- 無 recentSampleCount → 顯示「尚未掃描」

NEW badge：
```typescript
const stored = localStorage.getItem(`asc:vc:${card.id}`)
const lastCount = stored ? Number(stored) : 0
const newCount = card.recentSampleCount - lastCount
// 開啟詳情頁時：
localStorage.setItem(`asc:vc:${card.id}`, String(card.recentSampleCount))
```

## Backend: GET /api/cards 擴充

新增欄位（由 observe route 或 cards route 在 SQL 計算）：

```sql
SELECT
  c.id, c.keyword, c.created_at, c.updated_at,
  COUNT(ca.id) AS recent_sample_count,
  MAX(pr.completed_at) AS last_scan_at
FROM cards c
LEFT JOIN candidates ca
  ON ca.card_id = c.id
  AND ca.created_at >= datetime('now', '-24 hours')
LEFT JOIN patrol_runs pr
  ON pr.card_id = c.id
  AND pr.status = 'completed'
GROUP BY c.id
```

TypeScript type 擴充：
```typescript
export type PatrolCard = {
  id: string
  keyword: string
  createdAt: string
  updatedAt: string
  recentSampleCount: number   // NEW
  lastScanAt: string | null   // NEW
}
```

## Detail Page Navigation

詳情頁由 `selectedId !== null` 觸發（現有邏輯），但：
- 加 `← 返回` 按鈕 → `navigate('dashboard')` + `setSelectedId(null)`
- Mobile: 詳情頁佔全版面，tab bar 維持顯示（讓用戶切到雷達）
- Desktop: 詳情頁取代整個內容區（tab bar 仍在 header）

## Responsive Breakpoints

使用現有 Tailwind config：
- Mobile: `< sm` (640px) → 2欄 grid，bottom tab bar
- Tablet: `sm–lg` (640–1024px) → 2欄 grid，top tab bar
- Desktop: `lg+` (1024px+) → 3欄 grid，top tab bar

## Build Sequence

1. Backend：擴充 `GET /api/cards` 加兩個欄位
2. Client types：PatrolCard 加欄位
3. Tab bar 元件 + URL routing 擴充
4. OverviewTab + KeywordStatusCard（含 NEW badge）
5. WorkstationTab（搬現有三個 panel）
6. RadarTab（搬現有 HotKeywordCloud）
7. Detail page 加返回按鈕 + mobile 全版面
8. 清掉舊版 sidebar / layout 殘留
