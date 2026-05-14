import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import './styles.css'
import type { AdminSession, FeedbackDecision, KeyStatus, KeywordObservation, ObservedPost, PatrolCard, PostDraft, QueueSnapshot, RadarTerm, ScamSignal, SchedulerStatus, Sentiment, SponsoredSignal, TaskStatus, TaskType, ThreadsSessionStatus } from './types'
import { APP_VERSION } from './version'

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  anger: '憤怒',
  complaint: '抱怨',
  help: '求助',
  sarcasm: '嘲諷',
  neutral: '中立',
  positive: '開心',
  support: '鼓勵'
}

const SENTIMENT_COLORS: Record<Sentiment, string> = {
  anger: '#dc2626',
  complaint: '#f97316',
  sarcasm: '#a855f7',
  help: '#0ea5e9',
  neutral: '#94a3b8',
  positive: '#16a34a',
  support: '#eab308'
}

const SENTIMENT_BAR_ORDER: Sentiment[] = ['anger', 'complaint', 'sarcasm', 'help', 'neutral', 'positive', 'support']

const SPONSORED_LABELS: Record<SponsoredSignal, string> = {
  none: '看起來自然',
  suspect: '可疑葉配',
  likely: '高機率葉配'
}

const SPONSORED_TONE: Record<SponsoredSignal, string> = {
  none: 'border-asphalt bg-paper',
  suspect: 'border-orange-500 bg-orange-100',
  likely: 'border-red-600 bg-red-100'
}

const SCAM_LABELS: Record<ScamSignal, string> = {
  none: '不像詐騙',
  suspect: '疑似詐騙',
  likely: '高機率詐騙'
}

const SCAM_TONE: Record<ScamSignal, string> = {
  none: 'border-asphalt bg-paper',
  suspect: 'border-pink-500 bg-pink-100',
  likely: 'border-red-700 bg-red-200 text-red-900'
}

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  pipeline: '貼文判讀',
  compose_post: '發文發想',
  image_gen: '生圖'
}

type Page = 'dashboard' | 'settings'
type DashTab = 'overview' | 'radar' | 'workstation'
type SettingsSection = 'admin' | 'keys' | 'threads' | 'pipeline'

// ─── routing helpers ────────────────────────────────────────────────────────

function navigate(path: string) { window.location.hash = path }

function getPageFromHash(): Page {
  return window.location.hash.startsWith('#settings') ? 'settings' : 'dashboard'
}

function getSettingsSection(): SettingsSection {
  const section = window.location.hash.replace(/^#settings\/?/, '')
  if (section === 'keys' || section === 'threads' || section === 'pipeline') return section
  return 'admin'
}

function getDashTabFromHash(): DashTab {
  const h = window.location.hash
  if (h.startsWith('#dashboard/card/')) return 'overview'
  if (h === '#dashboard/radar') return 'radar'
  if (h === '#dashboard/workstation') return 'workstation'
  return 'overview'
}

function getDashboardCardId(): string | null {
  const match = window.location.hash.match(/^#dashboard\/card\/(.+)/)
  return match ? match[1] : null
}

// ─── localStorage NEW-badge helpers ─────────────────────────────────────────

const VC_KEY = 'asc:vc'

function getViewedCounts(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(VC_KEY) ?? '{}') } catch { return {} }
}

function markCardViewed(cardId: string, count: number) {
  const m = getViewedCounts()
  m[cardId] = count
  localStorage.setItem(VC_KEY, JSON.stringify(m))
}

function getNewBadge(card: PatrolCard): number {
  const last = getViewedCounts()[card.id] ?? 0
  return Math.max(0, card.recentSampleCount - last)
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<Page>(() => getPageFromHash())
  const [dashTab, setDashTab] = useState<DashTab>(() => getDashTabFromHash())
  const [cards, setCards] = useState<PatrolCard[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => getDashboardCardId())
  const [observation, setObservation] = useState<KeywordObservation | null>(null)
  const [observationLoading, setObservationLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [radarTerms, setRadarTerms] = useState<RadarTerm[]>([])
  const [radarLoading, setRadarLoading] = useState(false)
  const [radarMeta, setRadarMeta] = useState<string | null>(null)
  const [aiQueue, setAiQueue] = useState<QueueSnapshot | null>(null)
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null)
  const [postDrafts, setPostDrafts] = useState<PostDraft[]>([])
  const [scanBusyLabel, setScanBusyLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const scanInFlightRef = useRef(false)

  useEffect(() => {
    void loadCards()
    void loadRadarTrends()
    void loadAiStatus()
    void loadSchedulerStatus()
    void loadPostDrafts()
    const aiTimer = window.setInterval(() => void loadAiStatus(), 3000)
    const schedulerTimer = window.setInterval(() => void loadSchedulerStatus(), 10000)
    const postDraftTimer = window.setInterval(() => void loadPostDrafts(), 5000)
    const onHashChange = () => {
      setPage(getPageFromHash())
      setDashTab(getDashTabFromHash())
      const cardId = getDashboardCardId()
      if (cardId !== null) setSelectedId(cardId)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.clearInterval(aiTimer)
      window.clearInterval(schedulerTimer)
      window.clearInterval(postDraftTimer)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) { setObservation(null); return }
    void loadObservation(selectedId)
    const id = window.setInterval(() => void loadObservation(selectedId), 30_000)
    return () => window.clearInterval(id)
  }, [selectedId])

  function selectCard(id: string) {
    navigate(`dashboard/card/${id}`)
    setSelectedId(id)
    setDashTab('overview')
  }

  function navigateDashTab(tab: DashTab) {
    if (tab === 'overview') navigate('dashboard')
    else navigate(`dashboard/${tab}`)
    setDashTab(tab)
    if (tab !== 'overview') setSelectedId(null)
  }

  async function loadCards() {
    const data = await api.listCards()
    setCards(data.cards)
    const hashCardId = getDashboardCardId()
    if (hashCardId && data.cards.some((c) => c.id === hashCardId)) {
      setSelectedId(hashCardId)
    } else if (!hashCardId && getDashTabFromHash() === 'overview') {
      // don't auto-navigate on overview tab — user stays on grid
    }
  }

  async function loadObservation(cardId: string) {
    setObservationLoading(true)
    try {
      const data = await api.getKeywordObservation(cardId)
      setObservation(data.observation)
      // update NEW badge: mark as viewed
      const card = cards.find((c) => c.id === cardId)
      if (card) markCardViewed(cardId, card.recentSampleCount)
    } catch (err) {
      setObservation(null)
      setError(getMessage(err))
    } finally {
      setObservationLoading(false)
    }
  }

  async function loadAiStatus() {
    try { setAiQueue((await api.getAiStatus()).queue) } catch { setAiQueue(null) }
  }

  async function loadSchedulerStatus() {
    try { setScheduler((await api.getSchedulerStatus()).scheduler) } catch { setScheduler(null) }
  }

  async function loadPostDrafts() {
    try { setPostDrafts((await api.listPostDrafts()).drafts) } catch { setPostDrafts([]) }
  }

  async function loadRadarTrends() {
    setRadarLoading(true)
    try { setRadar((await api.getRadarTrends()).radar) }
    catch (err) { setRadarTerms([]); setRadarMeta(getMessage(err)) }
    finally { setRadarLoading(false) }
  }

  async function runRadarScan() {
    setRadarLoading(true)
    try { setRadar((await api.runRadarScan()).radar) }
    catch (err) { setRadarTerms([]); setRadarMeta(getMessage(err)) }
    finally { setRadarLoading(false) }
  }

  async function runComposePost() {
    setError(null)
    try {
      const data = await api.runComposePost()
      setNotice(`已排入發文發想工作：${data.queued.payload.seedKeyword}`)
      await loadAiStatus()
      await loadPostDrafts()
    } catch (err) { setError(getMessage(err)) }
  }

  function setRadar(radar: { terms: RadarTerm[]; sampledCandidates: number; source: 'threads_playwright' | 'threads_search' | 'mixed'; scanRun?: { candidatesAdded: number } }) {
    setRadarTerms(radar.terms)
    const inserted = radar.scanRun ? `；本次新增 ${radar.scanRun.candidatesAdded} 筆` : ''
    setRadarMeta(`最近 24 小時實際候選 ${radar.sampledCandidates} 筆；來源 ${formatRadarSource(radar.source)}${inserted}`)
  }

  async function createCard(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const data = await api.createCard(keyword)
      setKeyword('')
      await loadCards()
      selectCard(data.card.id)
      setNotice('海巡卡建立好了。只好讓我來幫幫你了。')
    } catch (err) { setError(getMessage(err)) }
  }

  function scanWithStream(cardId: string, keyword: string, onDone: (message: string) => void) {
    scanInFlightRef.current = true
    setScanBusyLabel(`「${keyword}」出勤中`)
    setError(null)
    setNotice(`「${keyword}」出勤海巡已送出，Threads 搜尋中…`)
    const es = new EventSource(`/api/cards/${cardId}/scan-threads/stream`)
    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(String(e.data)) as { type: string; stage?: string; run?: { message: string }; message?: string }
        if (event.type === 'progress' && event.stage === 'searching') {
          setScanBusyLabel(`「${keyword}」Threads 搜尋中`)
          setNotice(`「${keyword}」Threads 搜尋中…`)
        } else if (event.type === 'done') {
          es.close(); scanInFlightRef.current = false; setScanBusyLabel(null)
          onDone(event.run?.message ?? '海巡完成。')
          void loadObservation(cardId)
          void loadCards()
        } else if (event.type === 'error') {
          es.close(); scanInFlightRef.current = false; setScanBusyLabel(null)
          setError(event.message ?? '海巡失敗。')
        }
      } catch { /* malformed SSE */ }
    }
    es.onerror = () => { es.close(); scanInFlightRef.current = false; setScanBusyLabel(null); setError('海巡連線中斷，請稍後再試。') }
  }

  async function monitorRadarTerm(term: string) {
    if (scanInFlightRef.current) return
    scanInFlightRef.current = true
    setScanBusyLabel(`加入「${term}」監控...`)
    setError(null)
    try {
      const existing = cards.find((card) => card.keyword === term)
      const card = existing ?? (await api.createCard(term)).card
      setKeyword('')
      await loadCards()
      selectCard(card.id)
      scanWithStream(card.id, term, (message) => {
        setNotice(`已把「${term}」加入監控並出勤。${message}`)
      })
    } catch (err) { scanInFlightRef.current = false; setScanBusyLabel(null); setError(getMessage(err)) }
  }

  function scanThreads() {
    if (!selectedId || scanInFlightRef.current) return
    const target = cards.find((card) => card.id === selectedId)?.keyword ?? '目前關鍵字'
    scanWithStream(selectedId, target, (message) => {
      setNotice(`${message} AI 正在背景判讀；30 秒內會自動刷新。`)
    })
  }

  async function addManualLink(url: string, title: string, excerpt: string) {
    if (!selectedId) return
    setError(null)
    try {
      await api.addCandidate(selectedId, url, title, excerpt)
      setNotice('手動連結已加入，但目前僅進入舊管線；AI 風向觀察以排程結果為主。')
    } catch (err) { setError(getMessage(err)) }
  }

  async function removeCard(card: PatrolCard) {
    if (!window.confirm(`確認刪除「${card.keyword}」？這會把該關鍵字的監控、候選樣本一起清掉。`)) return
    setError(null)
    try {
      await api.deleteCard(card.id)
      if (selectedId === card.id) {
        navigate('dashboard')
        setSelectedId(null)
        setObservation(null)
      }
      await loadCards()
      setNotice(`已刪除關鍵字「${card.keyword}」。`)
    } catch (err) { setError(getMessage(err)) }
  }

  async function submitFeedback(post: ObservedPost, decision: FeedbackDecision, comment?: string) {
    if (!post.draft) return
    try {
      await api.submitVoiceFeedback({ draftId: post.id, variantIdx: post.draft.variantIdx, decision, comment })
      setNotice(decision === 'rewrite' ? '改寫意見收到，會餵進 voice 訓練。' : '紀錄了你的回饋。')
    } catch (err) { setError(getMessage(err)) }
  }

  const selectedCard = cards.find((c) => c.id === selectedId) ?? null

  return (
    <main className="min-h-screen overflow-x-hidden bg-paper text-asphalt">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b-4 border-asphalt bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="min-w-0 shrink-0">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.28em] text-signal sm:text-xs">Social Patrol</p>
            <h1 className="font-display text-xl font-black leading-none tracking-tight sm:text-2xl md:text-3xl">社群海巡工作站</h1>
          </div>
          {/* Desktop tab bar */}
          <nav className="hidden sm:flex items-center gap-1">
            {page === 'dashboard' && (
              <>
                <TabBtn label="概覽" active={dashTab === 'overview' && !selectedId} onClick={() => navigateDashTab('overview')} />
                <TabBtn label="雷達" active={dashTab === 'radar'} onClick={() => navigateDashTab('radar')} />
                <TabBtn label="工作站" active={dashTab === 'workstation'} onClick={() => navigateDashTab('workstation')} />
              </>
            )}
            <div className="mx-2 h-6 w-px bg-asphalt/30" />
            <TabBtn label="Settings" active={page === 'settings'} onClick={() => navigate('settings/admin')} />
            <div className="ml-2 flex h-9 items-center border-2 border-asphalt px-2 font-mono text-xs">v{APP_VERSION}</div>
          </nav>
          {/* Mobile: just version + settings icon */}
          <div className="flex sm:hidden items-center gap-2">
            <button onClick={() => navigate('settings/admin')} className={`min-h-9 border-2 border-asphalt px-2 py-1 text-xs font-bold ${page === 'settings' ? 'bg-asphalt text-paper' : 'bg-paper'}`}>⚙</button>
            <div className="flex h-9 items-center border-2 border-asphalt px-2 font-mono text-xs">v{APP_VERSION}</div>
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <div className="mx-auto max-w-7xl min-w-0 px-3 py-4 sm:px-4 sm:py-6 pb-24 sm:pb-6">
        {/* Global notices */}
        {notice && <Message tone="notice" text={notice} onClose={() => setNotice(null)} />}
        {error && <Message tone="error" text={error} onClose={() => setError(null)} />}

        {page === 'settings'
          ? <SettingsPage />
          : selectedId
            ? <KeywordDetailPage
                card={selectedCard}
                observation={observation}
                loading={observationLoading}
                scanBusyLabel={scanBusyLabel}
                onBack={() => { navigate('dashboard'); setSelectedId(null); setObservation(null) }}
                onScanThreads={scanThreads}
                onAddManualLink={addManualLink}
                onFeedback={submitFeedback}
                onSelectSuggestedKeyword={(term) => void monitorRadarTerm(term)}
                onDeleteCard={removeCard}
              />
            : dashTab === 'radar'
              ? <RadarTab
                  terms={radarTerms} loading={radarLoading} meta={radarMeta}
                  scanBusy={Boolean(scanBusyLabel)}
                  onRefresh={runRadarScan}
                  onSelect={(term) => void monitorRadarTerm(term)}
                />
              : dashTab === 'workstation'
                ? <WorkstationTab drafts={postDrafts} queue={aiQueue} scheduler={scheduler} onRunCompose={runComposePost} />
                : <OverviewTab
                    cards={cards}
                    keyword={keyword}
                    scanBusyLabel={scanBusyLabel}
                    onSelectCard={selectCard}
                    onDeleteCard={removeCard}
                    onKeywordChange={setKeyword}
                    onCreateCard={createCard}
                  />
        }
      </div>

      {/* ── Mobile bottom tab bar ── */}
      {page === 'dashboard' && (
        <nav className="fixed bottom-0 left-0 right-0 z-10 flex sm:hidden border-t-4 border-asphalt bg-paper/95 backdrop-blur">
          <MobileTabBtn label="概覽" active={dashTab === 'overview'} onClick={() => navigateDashTab('overview')} />
          <MobileTabBtn label="雷達" active={dashTab === 'radar'} onClick={() => navigateDashTab('radar')} />
          <MobileTabBtn label="工作站" active={dashTab === 'workstation'} onClick={() => navigateDashTab('workstation')} />
        </nav>
      )}
    </main>
  )
}

// ─── Tab bar buttons ─────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 border-2 border-asphalt px-3 py-1 text-sm font-bold transition-colors ${active ? 'bg-asphalt text-paper' : 'bg-paper hover:bg-signal/10'}`}
    >
      {label}
    </button>
  )
}

function MobileTabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 text-xs font-bold border-t-2 transition-colors ${active ? 'border-signal text-signal' : 'border-transparent text-asphalt/60'}`}
    >
      {label}
    </button>
  )
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ cards, keyword, scanBusyLabel, onSelectCard, onDeleteCard, onKeywordChange, onCreateCard }: {
  cards: PatrolCard[]
  keyword: string
  scanBusyLabel: string | null
  onSelectCard: (id: string) => void
  onDeleteCard: (card: PatrolCard) => void
  onKeywordChange: (v: string) => void
  onCreateCard: (e: React.FormEvent) => void
}) {
  return (
    <div className="space-y-4">
      <div className="border-2 border-asphalt bg-paper p-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Watchlist</p>
        <h2 className="text-2xl font-black">關鍵字監控</h2>
        <p className="mt-1 text-xs text-asphalt/70">點關鍵字卡查看 Threads 風向。橘色數字代表比上次開啟多了幾則新樣本。</p>
      </div>

      {cards.length === 0
        ? <div className="border-4 border-dashed border-asphalt p-10 text-center font-black text-lg">還沒有監控關鍵字。加一個開始吧。</div>
        : <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <KeywordStatusCard
                key={card.id}
                card={card}
                scanBusy={Boolean(scanBusyLabel)}
                onSelect={() => onSelectCard(card.id)}
                onDelete={() => onDeleteCard(card)}
              />
            ))}
          </div>
      }

      <form onSubmit={onCreateCard} className="border-4 border-asphalt bg-[#fffaf2] p-4 shadow-[5px_5px_0_#171717]">
        <label className="block text-sm font-bold">新增監控關鍵字</label>
        <div className="mt-2 flex gap-2">
          <input
            className="min-h-11 flex-1 border-2 border-asphalt bg-paper px-3 text-base outline-none focus:bg-white"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="例如：AI 小編、Threads 經營"
          />
          <button className="min-h-11 bg-asphalt px-4 font-bold text-paper hover:bg-signal" type="submit">加入</button>
        </div>
      </form>
    </div>
  )
}

function KeywordStatusCard({ card, scanBusy, onSelect, onDelete }: {
  card: PatrolCard
  scanBusy: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const newCount = getNewBadge(card)
  return (
    <div className="relative border-4 border-asphalt bg-paper shadow-[4px_4px_0_#171717] hover:shadow-[6px_6px_0_#171717] transition-shadow">
      <button type="button" onClick={onSelect} disabled={scanBusy} className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-1">
          <span className="text-xl font-black leading-tight break-all">{card.keyword}</span>
          {newCount > 0 && (
            <span className="shrink-0 rounded-full bg-signal px-2 py-0.5 font-mono text-xs font-black text-white">+{newCount}</span>
          )}
        </div>
        <div className="mt-2 font-mono text-xs text-asphalt/60">
          {card.recentSampleCount > 0 ? `${card.recentSampleCount} 則 · ` : ''}{card.lastScanAt ? formatRelative(card.lastScanAt) : '尚未掃描'}
        </div>
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="刪除"
        className="absolute right-1 top-1 px-1.5 py-0.5 font-mono text-xs text-asphalt/30 hover:text-red-600 hover:bg-red-50"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Radar Tab ───────────────────────────────────────────────────────────────

function RadarTab({ terms, loading, meta, scanBusy, onRefresh, onSelect }: {
  terms: RadarTerm[]; loading: boolean; meta: string | null
  scanBusy: boolean; onRefresh: () => void; onSelect: (keyword: string) => void
}) {
  const max = Math.max(1, ...terms.map((t) => t.count))
  return (
    <section className="space-y-4">
      <div className="border-4 border-asphalt bg-white p-4 shadow-[5px_5px_0_#171717] sm:p-5 sm:shadow-[8px_8px_0_#171717]">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-signal">Patrol Radar</p>
            <h2 className="text-3xl font-black sm:text-4xl">熱門關鍵字雲</h2>
            {meta && <p className="mt-1 font-mono text-xs text-asphalt/60">{meta}</p>}
          </div>
          <div className="space-y-2 text-sm">
            <p>只顯示已寫入資料庫的 Threads 實際候選抽詞。點詞會直接加入監控並出勤。</p>
            <button type="button" onClick={onRefresh} disabled={loading} className="min-h-9 border-2 border-asphalt px-3 py-1 font-bold hover:bg-signal hover:text-white">
              {loading ? '掃描中' : '掃描 Threads 雷達'}
            </button>
          </div>
        </div>
        <div className="mt-5 min-h-[240px] rounded-[1.5rem] border-2 border-dashed border-asphalt/25 bg-[radial-gradient(circle_at_center,#fffaf2,white_62%)] p-3 sm:min-h-[280px] sm:p-5">
          {loading
            ? <div className="flex min-h-[220px] items-center justify-center text-xl font-black text-asphalt/50">正在掃描 Threads 並寫入候選資料...</div>
            : terms.length > 0
              ? <div className="flex h-full min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 leading-none">
                  {terms.map((term, i) => (
                    <button
                      key={`${term.word}-${i}`}
                      type="button"
                      onClick={() => onSelect(term.word)}
                      disabled={scanBusy}
                      className={`max-w-full break-all text-center font-black leading-tight transition-transform sm:break-normal ${scanBusy ? 'cursor-wait opacity-40' : 'hover:scale-110'}`}
                      style={{ color: cloudColor(i), fontSize: `${Math.round(16 + (term.count / max) * 42)}px`, transform: `rotate(${cloudRotate(i)}deg)` }}
                      title={`出現 ${term.count} 次`}
                    >
                      {term.word}
                    </button>
                  ))}
                </div>
              : <div className="flex min-h-[220px] items-center justify-center text-center text-xl font-black text-asphalt/50">最近 24 小時還沒有可用的 Threads 實際詞，請掃描雷達或先匯入 Threads session。</div>
          }
        </div>
      </div>
    </section>
  )
}

// ─── Workstation Tab ─────────────────────────────────────────────────────────

function WorkstationTab({ drafts, queue, scheduler, onRunCompose }: {
  drafts: PostDraft[]; queue: QueueSnapshot | null; scheduler: SchedulerStatus | null; onRunCompose: () => Promise<void>
}) {
  return (
    <div className="space-y-4">
      <PostDraftPanel drafts={drafts} onRunCompose={onRunCompose} />
      <AiQueuePanel queue={queue} />
      <SchedulerPanel scheduler={scheduler} />
    </div>
  )
}

// ─── Keyword Detail Page ─────────────────────────────────────────────────────

function KeywordDetailPage({ card, observation, loading, scanBusyLabel, onBack, onScanThreads, onAddManualLink, onFeedback, onSelectSuggestedKeyword, onDeleteCard }: {
  card: PatrolCard | null
  observation: KeywordObservation | null
  loading: boolean
  scanBusyLabel: string | null
  onBack: () => void
  onScanThreads: () => void
  onAddManualLink: (url: string, title: string, excerpt: string) => Promise<void>
  onFeedback: (post: ObservedPost, decision: FeedbackDecision, comment?: string) => Promise<void>
  onSelectSuggestedKeyword: (term: string) => void
  onDeleteCard: (card: PatrolCard) => void
}) {
  return (
    <div className="space-y-4">
      {/* Back bar */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1 border-2 border-asphalt bg-paper px-3 py-1.5 text-sm font-bold hover:bg-asphalt hover:text-paper">
          ← 返回概覽
        </button>
        {card && (
          <button
            type="button"
            onClick={() => onDeleteCard(card)}
            className="border-2 border-red-600 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-600 hover:text-white"
          >
            刪除「{card.keyword}」
          </button>
        )}
      </div>

      <KeywordObservationPanel
        observation={observation}
        loading={loading}
        scanBusyLabel={scanBusyLabel}
        onScanThreads={onScanThreads}
        onAddManualLink={onAddManualLink}
        onFeedback={onFeedback}
        onSelectSuggestedKeyword={onSelectSuggestedKeyword}
      />
    </div>
  )
}

// ─── Existing panels (unchanged logic, kept as-is) ───────────────────────────

function KeywordObservationPanel({ observation, loading, scanBusyLabel, onScanThreads, onAddManualLink, onFeedback, onSelectSuggestedKeyword }: {
  observation: KeywordObservation | null
  loading: boolean
  scanBusyLabel: string | null
  onScanThreads: () => void
  onAddManualLink: (url: string, title: string, excerpt: string) => Promise<void>
  onFeedback: (post: ObservedPost, decision: FeedbackDecision, comment?: string) => Promise<void>
  onSelectSuggestedKeyword: (term: string) => void
}) {
  if (!observation) {
    return <div className="border-4 border-asphalt p-8 text-center text-lg font-black sm:p-10">{loading ? '正在讀取觀察站資料...' : '請稍候…'}</div>
  }
  const { card, aggregate, highlights, posts, suggestedKeywords } = observation
  const dominant = useMemo(() => dominantSentiment(aggregate.sentimentDistribution), [aggregate.sentimentDistribution])
  const hasAnyPost = highlights.length + posts.length > 0

  return (
    <div className="space-y-4">
      <section className="border-4 border-asphalt bg-[#fffaf2] p-5 shadow-[6px_6px_0_#171717] sm:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Keyword Observation</p>
            <h2 className="mt-1 text-3xl font-black sm:text-4xl">{card.keyword} 風向</h2>
            <p className="mt-2 text-sm">
              {aggregate.totalSamples} 則樣本（過去 24h）·
              已判讀 {aggregate.classifiedSamples} 則 ·
              葉配率 {formatPct(aggregate.sponsoredRate)} ·
              詐騙率 {formatPct(aggregate.scamRate)} ·
              主要情緒：{dominant ? SENTIMENT_LABELS[dominant] : '尚不足判斷'}
              {aggregate.pipelineBlockedCount > 0 ? ` · ${aggregate.pipelineBlockedCount} 則 AI 判讀失敗` : ''}
            </p>
          </div>
          <button onClick={onScanThreads} disabled={Boolean(scanBusyLabel)} className={`min-h-11 px-4 py-2 font-bold text-white transition-colors ${scanBusyLabel ? 'cursor-wait bg-asphalt/60' : 'bg-signal hover:bg-asphalt'}`}>
            {scanBusyLabel ? '海巡中...' : 'Threads 出勤海巡'}
          </button>
        </div>
        {scanBusyLabel && (
          <div className="mt-4 flex items-center gap-3 border-2 border-asphalt bg-white px-3 py-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-asphalt border-t-transparent" />
            <span className="text-sm font-bold">{scanBusyLabel}</span>
          </div>
        )}
        <SentimentBar distribution={aggregate.sentimentDistribution} classifiedSamples={aggregate.classifiedSamples} />
        {suggestedKeywords.length > 0 && (
          <div className="mt-4 border-t-2 border-asphalt pt-4">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Suggested Keywords</p>
            <p className="mt-1 text-xs text-asphalt/70">從目前樣本抽出的延伸詞；點了才會加入監控並出勤。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestedKeywords.map((term) => (
                <button key={term} type="button" onClick={() => onSelectSuggestedKeyword(term)} disabled={Boolean(scanBusyLabel)} className={`min-h-9 border-2 border-asphalt bg-paper px-3 py-1 text-sm font-bold ${scanBusyLabel ? 'cursor-wait opacity-50' : 'hover:bg-asphalt hover:text-paper'}`}>
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {highlights.length > 0 && (
        <section className="border-4 border-signal bg-[#fff5e6] p-4 shadow-[6px_6px_0_#171717]">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">High-engagement Highlights</p>
              <h3 className="text-2xl font-black">重點貼文（按互動排序）</h3>
            </div>
            <p className="font-mono text-xs text-asphalt/60">讚 + 留言×3 計分，門檻 ≥ 50</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {highlights.map((post) => <ObservedPostCard key={post.id} post={post} onFeedback={onFeedback} highlight />)}
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">其它樣本（最新優先）</p>
          <div className="grid gap-4 xl:grid-cols-2">
            {posts.map((post) => <ObservedPostCard key={post.id} post={post} onFeedback={onFeedback} />)}
          </div>
        </div>
      )}

      {!hasAnyPost && (
        <div className="border-2 border-dashed border-asphalt p-8 text-center">
          尚無樣本。按上方「Threads 出勤海巡」抓一輪，或等下一次自動排程。
        </div>
      )}

      <ManualLinkImport onSubmit={onAddManualLink} />
    </div>
  )
}

function SentimentBar({ distribution, classifiedSamples }: { distribution: Record<Sentiment, { count: number; pct: number }>; classifiedSamples: number }) {
  if (classifiedSamples === 0) {
    return <div className="mt-4 flex h-10 items-center justify-center border-2 border-dashed border-asphalt/40 text-sm text-asphalt/60">尚無 AI 判讀樣本，跑一次 Threads 海巡讓 AI 上工。</div>
  }
  return (
    <>
      <div className="mt-4 flex h-10 w-full overflow-hidden border-2 border-asphalt">
        {SENTIMENT_BAR_ORDER.map((key) => {
          const bucket = distribution[key]
          if (bucket.count === 0) return null
          return (
            <div key={key} className="flex items-center justify-center text-xs font-black text-white" style={{ width: `${Math.max(bucket.pct * 100, 4)}%`, background: SENTIMENT_COLORS[key] }} title={`${SENTIMENT_LABELS[key]} ${bucket.count} 則 (${formatPct(bucket.pct)})`}>
              {bucket.pct >= 0.08 ? SENTIMENT_LABELS[key] : null}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono">
        {SENTIMENT_BAR_ORDER.map((key) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 border border-asphalt" style={{ background: SENTIMENT_COLORS[key] }} />
            {SENTIMENT_LABELS[key]} {distribution[key].count}
          </span>
        ))}
      </div>
    </>
  )
}

function ObservedPostCard({ post, onFeedback, highlight = false }: { post: ObservedPost; onFeedback: (post: ObservedPost, decision: FeedbackDecision, comment?: string) => Promise<void>; highlight?: boolean }) {
  const [expandedReasons, setExpandedReasons] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [rewriteText, setRewriteText] = useState('')
  const [lastDecision, setLastDecision] = useState<FeedbackDecision | null>(null)
  const [scamExpanded, setScamExpanded] = useState(false)
  const sponsoredBadge = post.sponsoredSignal ?? null
  const scamBadge = post.scamSignal ?? null
  const engagementScore = (post.likes ?? 0) + (post.replyCount ?? 0) * 3 + (post.reposts ?? 0) * 5 + (post.shares ?? 0) * 2

  return (
    <article className={`p-4 ${highlight ? 'border-4 border-signal bg-white shadow-[8px_8px_0_#f97316]' : 'border-4 border-asphalt bg-[#fffaf2] shadow-[6px_6px_0_#171717]'}`}>
      {highlight && <p className="mb-2 inline-block bg-signal px-2 py-0.5 text-xs font-black text-white">熱門 · 互動分 {engagementScore}</p>}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">{post.author ?? '匿名作者'} · {post.source}</p>
          <a className="mt-1 block break-all text-sm underline" href={post.url} target="_blank" rel="noreferrer">{post.url}</a>
        </div>
        {post.postedAt && <span className="border-2 border-asphalt px-2 py-1 font-mono text-xs">{formatDate(post.postedAt)}</span>}
      </header>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat label="讚" value={post.likes} accent="bg-red-100" />
        <Stat label="留言" value={post.replyCount} accent="bg-blue-100" />
        <Stat label="轉發" value={post.reposts} accent="bg-green-100" />
        <Stat label="分享" value={post.shares} accent="bg-yellow-100" />
      </div>

      <p className="mt-3 whitespace-pre-line border-l-4 border-signal pl-3 text-sm">{post.excerpt}</p>

      {(post.images.length > 0 || post.videos.length > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {post.videos.slice(0, 4).map((video) => (
            <a key={video.src} href={post.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden border-2 border-asphalt bg-black">
              {video.poster ? <img src={video.poster} alt="影片預覽" loading="lazy" referrerPolicy="no-referrer" className="h-32 w-full object-cover opacity-90" /> : <div className="flex h-32 w-full items-center justify-center bg-asphalt text-paper font-mono text-xs">影片</div>}
              <div className="absolute inset-0 flex items-center justify-center"><span className="border-2 border-paper bg-asphalt/80 px-2 py-1 text-xs font-black text-paper">▶ 影片</span></div>
            </a>
          ))}
          {post.images.slice(0, 6).map((src) => (
            <a key={src} href={post.url} target="_blank" rel="noreferrer" className="block overflow-hidden border-2 border-asphalt bg-paper">
              <img src={src} alt="Threads 貼文圖" loading="lazy" referrerPolicy="no-referrer" className="h-32 w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
        {post.sentiment ? <span className="border-2 border-asphalt px-2 py-1 text-white" style={{ background: SENTIMENT_COLORS[post.sentiment] }}>{SENTIMENT_LABELS[post.sentiment]}</span>
          : post.pipelineStatus === 'pipeline_blocked' ? null
          : <span className="border-2 border-asphalt bg-paper px-2 py-1">情緒判讀中</span>}
        {post.topic && <span className="border-2 border-asphalt bg-paper px-2 py-1">主題：{post.topic}</span>}
        {sponsoredBadge && <button type="button" onClick={() => setExpandedReasons((v) => !v)} className={`border-2 px-2 py-1 ${SPONSORED_TONE[sponsoredBadge]}`}>{SPONSORED_LABELS[sponsoredBadge]} {post.sponsoredReasons.length > 0 ? (expandedReasons ? '▲' : '▼') : ''}</button>}
        {scamBadge && scamBadge !== 'none' && <button type="button" onClick={() => setScamExpanded((v) => !v)} className={`border-2 px-2 py-1 ${SCAM_TONE[scamBadge]}`}>{SCAM_LABELS[scamBadge]} {post.scamReasons.length > 0 ? (scamExpanded ? '▲' : '▼') : ''}</button>}
        {post.pipelineStatus === 'pipeline_blocked' && <span className="border-2 border-red-600 bg-red-100 px-2 py-1 text-red-700">AI 判讀失敗</span>}
      </div>
      {expandedReasons && post.sponsoredReasons.length > 0 && <ul className="mt-2 list-disc border-2 border-asphalt bg-paper p-3 pl-6 text-sm">{post.sponsoredReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {scamExpanded && post.scamReasons.length > 0 && <ul className="mt-2 list-disc border-2 border-red-700 bg-red-50 p-3 pl-6 text-sm text-red-900">{post.scamReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}

      <section className="mt-4 border-2 border-asphalt bg-paper p-3">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">AI 建議留言</p>
        {post.draft ? (
          <>
            <p className="mt-1 whitespace-pre-line text-sm">{post.draft.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => copyText(post.draft!.text)} className="min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-asphalt hover:text-paper">複製</button>
              <button onClick={() => { setLastDecision('like'); void onFeedback(post, 'like') }} className={`min-h-10 border-2 px-3 py-1 text-sm font-bold ${lastDecision === 'like' ? 'border-green-700 bg-green-100' : 'border-asphalt'}`}>👍 像我</button>
              <button onClick={() => { setLastDecision('dislike'); void onFeedback(post, 'dislike') }} className={`min-h-10 border-2 px-3 py-1 text-sm font-bold ${lastDecision === 'dislike' ? 'border-red-700 bg-red-100' : 'border-asphalt'}`}>👎 不像</button>
              <button onClick={() => setRewriting((v) => !v)} className={`min-h-10 border-2 px-3 py-1 text-sm font-bold ${rewriting ? 'border-signal bg-signal text-white' : 'border-asphalt'}`}>✏️ 改寫</button>
            </div>
            {rewriting && (
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (!rewriteText.trim()) return; setLastDecision('rewrite'); void onFeedback(post, 'rewrite', rewriteText.trim()); setRewriteText(''); setRewriting(false) }}>
                <textarea className="min-h-20 w-full border-2 border-asphalt bg-[#fffaf2] p-2 text-sm" placeholder="這版怎樣改才更像我？" value={rewriteText} onChange={(e) => setRewriteText(e.target.value)} />
                <button type="submit" className="min-h-10 bg-asphalt px-3 py-1 text-sm font-bold text-paper">送出改寫建議</button>
              </form>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-asphalt/60">{post.scoreReason ? `沒有產 AI 草稿：${post.scoreReason}` : '草稿暫不可用'}</p>
        )}
      </section>
    </article>
  )
}

function ManualLinkImport({ onSubmit }: { onSubmit: (url: string, title: string, excerpt: string) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    await onSubmit(url.trim(), title.trim(), excerpt.trim())
    setUrl(''); setTitle(''); setExcerpt('')
  }

  return (
    <form onSubmit={submit} className="border-2 border-dashed border-asphalt p-4">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Manual Backup</p>
      <h3 className="mt-1 text-lg font-black">手動加 Threads 連結（備援）</h3>
      <p className="mt-1 text-sm">出勤海巡沒抓到、又想觀察特定貼文時用。</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1.5fr_1fr_1fr_auto]">
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.threads.net/..." />
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="標題（可空）" />
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="摘錄（可空）" />
        <button className="min-h-11 bg-signal px-4 py-2 font-bold text-white" type="submit">加入</button>
      </div>
    </form>
  )
}

function AiQueuePanel({ queue }: { queue: QueueSnapshot | null }) {
  if (!queue) return <section className="border-2 border-dashed border-asphalt bg-paper p-4 font-mono text-xs">AI Worker · 連線中…</section>
  const types: TaskType[] = ['pipeline', 'compose_post', 'image_gen']
  const totalPending = types.reduce((s, t) => s + (queue.countsByType[t]?.pending ?? 0), 0)
  const totalRunning = types.reduce((s, t) => s + (queue.countsByType[t]?.running ?? 0), 0)
  const totalFailed = types.reduce((s, t) => s + (queue.countsByType[t]?.failed ?? 0), 0)
  return (
    <section className="border-4 border-asphalt bg-paper p-4 shadow-[5px_5px_0_#171717]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">AI Worker</p>
          <h3 className="text-xl font-black">AI 工作站</h3>
        </div>
        <p className="font-mono text-xs text-asphalt/60">排隊 {totalPending} · 進行中 {totalRunning} · 失敗 {totalFailed}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {types.map((type) => {
          const bucket = queue.countsByType[type] ?? { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
          const active = bucket.pending + bucket.running > 0
          return (
            <div key={type} className={`border-2 border-asphalt p-2 ${active ? 'bg-[#fffaf2]' : 'bg-paper'}`}>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-signal">{TASK_TYPE_LABELS[type]}</p>
              <p className="mt-1 text-xs">排隊 {bucket.pending} / 跑 {bucket.running}</p>
              <p className="font-mono text-[0.65rem] text-asphalt/60">完成 {bucket.completed} · 失敗 {bucket.failed}</p>
            </div>
          )
        })}
      </div>
      {queue.inflight.length > 0 && (
        <div className="mt-3 border-2 border-asphalt bg-[#fffaf2] p-2 text-xs">
          <p className="font-mono uppercase tracking-[0.2em] text-signal">正在處理</p>
          <ul className="mt-1 space-y-1">{queue.inflight.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span className="rounded-sm bg-asphalt px-1 py-0.5 text-[0.65rem] font-bold text-paper">{TASK_TYPE_LABELS[task.type]}</span>
              <span className="truncate">{task.label}</span>
            </li>
          ))}</ul>
        </div>
      )}
      {queue.recent.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-signal">最近 10 筆紀錄</summary>
          <ul className="mt-2 space-y-1 text-xs">{queue.recent.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <span className={`rounded-sm px-1 py-0.5 text-[0.65rem] font-bold ${recentTone(task.status)}`}>{task.status}</span>
              <span className="truncate">{task.label}</span>
              {task.error && <span className="truncate text-red-700">— {task.error}</span>}
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  )
}

function SchedulerPanel({ scheduler }: { scheduler: SchedulerStatus | null }) {
  if (!scheduler) return <section className="border-2 border-dashed border-asphalt bg-paper p-4 font-mono text-xs">Keyword Auto Scan · 連線中…</section>
  return (
    <section className="border-4 border-asphalt bg-paper p-4 shadow-[5px_5px_0_#171717]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Keyword Auto Scan</p>
          <h3 className="text-xl font-black">關鍵字自動海巡</h3>
        </div>
        <p className="font-mono text-xs text-asphalt/60">cadence {scheduler.cadence}</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5 text-sm">
        {[
          ['狀態', formatSchedulerStatus(scheduler.lastStatus)],
          ['下次海巡', scheduler.nextRunAt ? formatDate(scheduler.nextRunAt) : '待計算'],
          ['上次開始', scheduler.lastStartedAt ? formatDate(scheduler.lastStartedAt) : '尚未執行'],
          ['上次完成', scheduler.lastCompletedAt ? formatDate(scheduler.lastCompletedAt) : '尚未完成'],
          ['上次成果', `掃 ${scheduler.lastCardCount} 張 / 新增 ${scheduler.lastInsertedCount} 筆`],
        ].map(([label, value]) => (
          <div key={label} className="border-2 border-asphalt bg-[#fffaf2] p-2">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-signal">{label}</p>
            <p className="mt-1 font-bold">{value}</p>
          </div>
        ))}
      </div>
      {scheduler.lastError && <p className="mt-3 text-sm text-red-700">{scheduler.lastError}</p>}
    </section>
  )
}

function PostDraftPanel({ drafts, onRunCompose }: { drafts: PostDraft[]; onRunCompose: () => Promise<void> }) {
  return (
    <section className="border-4 border-asphalt bg-white p-4 shadow-[5px_5px_0_#171717]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Post Composer</p>
          <h3 className="text-xl font-black">發文發想</h3>
          <p className="mt-1 text-sm text-asphalt/70">用最近 24 小時的 Threads 雷達樣本，生一則你自己可以發的原創貼文草稿。</p>
        </div>
        <button onClick={() => void onRunCompose()} className="min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-signal hover:text-white">生一篇發文靈感</button>
      </div>
      {drafts.length === 0
        ? <div className="mt-3 border-2 border-dashed border-asphalt p-4 text-sm text-asphalt/60">還沒有發文草稿。先掃一輪雷達，再按上方按鈕。</div>
        : <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {drafts.slice(0, 4).map((draft) => (
              <article key={draft.id} className="border-2 border-asphalt bg-[#fffaf2] p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="border-2 border-asphalt bg-paper px-2 py-1">{draft.seedKeyword ?? '未分類'}</span>
                  {draft.angle && <span className="border-2 border-asphalt bg-paper px-2 py-1">角度：{draft.angle}</span>}
                  <span className="font-mono text-asphalt/60">{formatDate(draft.createdAt)}</span>
                </div>
                {draft.seedTopic && <p className="mt-2 text-sm font-bold">主題：{draft.seedTopic}</p>}
                <p className="mt-2 whitespace-pre-line text-sm">{draft.text}</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => copyText(draft.text)} className="min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-asphalt hover:text-paper">複製貼文</button>
                </div>
                {draft.imagePrompt && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-signal">圖片提示詞</summary>
                    <p className="mt-2 border-2 border-asphalt bg-paper p-2">{draft.imagePrompt}</p>
                  </details>
                )}
              </article>
            ))}
          </div>
      }
    </section>
  )
}

// ─── Settings Page (unchanged) ───────────────────────────────────────────────

function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>(() => getSettingsSection())
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [threadsSession, setThreadsSession] = useState<ThreadsSessionStatus | null>(null)
  const [keyText, setKeyText] = useState('')
  const [threadsStorageState, setThreadsStorageState] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refreshAdminSession()
    void refreshThreadsSession()
    const onHashChange = () => setSection(getSettingsSection())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!adminSession?.authenticated) return
    void refreshKeys()
    const timer = setInterval(() => { void refreshKeys() }, 10_000)
    return () => clearInterval(timer)
  }, [adminSession?.authenticated])

  async function refreshAdminSession() {
    try { setAdminSession((await api.getAdminSession()).session) } catch (err) { setError(getMessage(err)) }
  }
  async function refreshKeys() {
    try { setKeys((await api.getKeyStatus()).keys) } catch (err) { setError(getMessage(err)) }
  }
  async function importKeys(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    try { const r = await api.importKeys(keyText); setMessage(`新增 ${r.inserted} 把、重複略過 ${r.duplicate} 把。`); setKeyText(''); await refreshKeys() }
    catch (err) { setError(getMessage(err)) }
  }
  async function syncKeys() {
    setError(null)
    try { const r = await api.syncKeys(); setMessage(r.synced ? `已從 key-manager 同步 ${r.imported} 把。${r.warning ?? ''}` : r.warning); await refreshKeys() }
    catch (err) { setError(getMessage(err)) }
  }
  async function resetCooldowns() {
    setError(null)
    try { const r = await api.resetKeyCooldowns(); setMessage(`已清除 ${r.reset} 把 key 的 cooldown。`); await refreshKeys() }
    catch (err) { setError(getMessage(err)) }
  }
  async function refreshThreadsSession() {
    try { setThreadsSession((await api.getThreadsSessionStatus()).session) } catch (err) { setError(getMessage(err)) }
  }
  async function clearThreadsSession() {
    setError(null)
    try { setThreadsSession((await api.clearThreadsSession()).session); setMessage('Threads session 已清除。') }
    catch (err) { setError(getMessage(err)) }
  }
  async function importThreadsSession(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    try { setThreadsSession((await api.importThreadsSession(threadsStorageState)).session); setThreadsStorageState(''); setMessage('Threads storageState 已加密保存。') }
    catch (err) { setError(getMessage(err)) }
  }
  async function importThreadsSessionFromFile() {
    setError(null)
    try { const d = await api.importThreadsSessionFromFile(); setThreadsSession(d.session); setMessage(`Threads session 已從 ${d.importedFrom} 匯入並加密保存。`) }
    catch (err) { setError(getMessage(err)) }
  }
  async function loadThreadsStorageStateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return; setError(null)
    try { setThreadsStorageState(await file.text()); setMessage('已載入 storageState JSON，請按「加密保存 Session」。') }
    catch (err) { setError(getMessage(err)) }
    finally { e.target.value = '' }
  }

  return (
    <section className="space-y-4">
      <div className="border-4 border-asphalt bg-[#fffaf2] p-5 shadow-[8px_8px_0_#171717]">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Settings / {section}</p>
        <h2 className="mt-1 text-4xl font-black">設定不是裝飾品</h2>
      </div>
      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['admin', 'keys', 'threads', 'pipeline'] as SettingsSection[]).map((item) => (
          <button key={item} type="button" onClick={() => navigate(`settings/${item}`)} className={`min-h-11 border-2 border-asphalt px-3 py-2 font-bold ${section === item ? 'bg-asphalt text-paper' : 'bg-paper'}`}>{item}</button>
        ))}
      </nav>
      {message && <Message tone="notice" text={message} onClose={() => setMessage(null)} />}
      {error && <Message tone="error" text={error} onClose={() => setError(null)} />}

      {section === 'admin' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Admin 狀態</h3>
        <p className="mt-1 text-sm">`ADMIN_TOKEN` 已由部署環境設定。這是單人 homelab 服務。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="ADMIN_TOKEN" value={adminSession?.configured ? 'server 已設定' : 'server 未設定'} />
          <Info label="Admin Access" value={adminSession?.authenticated ? '已可操作' : '不可操作'} />
        </div>
        <button className="mt-3 min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshAdminSession}>重新檢查</button>
      </div>}

      {section === 'keys' && <>
        <form onSubmit={importKeys} className="border-2 border-asphalt bg-paper p-4">
          <h3 className="text-2xl font-black">Key Pool 匯入</h3>
          <p className="mt-1 text-sm">一行一把 Gemini key，`#` 開頭會略過。</p>
          <textarea className="mt-3 min-h-48 w-full border-2 border-asphalt bg-[#fffaf2] p-3 font-mono text-sm outline-none" value={keyText} onChange={(e) => setKeyText(e.target.value)} placeholder={'# paste keys here\nAIza...'} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="min-h-11 bg-asphalt px-4 py-2 font-bold text-paper" type="submit">匯入 keys</button>
            <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={syncKeys}>從 key-manager 同步</button>
            <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshKeys}>重新整理</button>
          </div>
        </form>
        <div className="border-2 border-asphalt bg-[#fffaf2] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-black">目前 keys</h3>
            <div className="flex gap-2">
              <button onClick={refreshKeys} className="border border-asphalt px-3 py-1 text-sm">重新整理</button>
              <button onClick={resetCooldowns} className="border border-red-600 px-3 py-1 text-sm text-red-600">清除所有 Cooldown</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-asphalt/60">每 10 秒自動更新</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead><tr className="border-b-2 border-asphalt"><th className="p-2">ID</th><th className="p-2">Suffix</th><th className="p-2">Health</th><th className="p-2">Usage</th><th className="p-2">Cooldown 到期</th></tr></thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-asphalt/30">
                    <td className="p-2 font-mono">{key.id}</td>
                    <td className="p-2 font-mono">...{key.suffix}</td>
                    <td className={`p-2 font-bold ${key.health === 'available' ? 'text-green-700' : key.health === 'cooldown' ? 'text-orange-600' : key.health === 'leased' ? 'text-blue-600' : 'text-asphalt/40'}`}>{key.health}</td>
                    <td className="p-2">{key.usageCount}</td>
                    <td className="p-2">{key.health === 'cooldown' ? formatDate(new Date(key.cooldownUntil).toISOString()) : '-'}</td>
                  </tr>
                ))}
                {keys.length === 0 && <tr><td className="p-4 text-center" colSpan={5}>目前沒有 key。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>}

      {section === 'threads' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Threads Session</h3>
        <p className="mt-1 text-sm">流程：在電腦本機跑 <code>npm run threads:login</code> → 完成 IG/Threads 登入 → 把產出的 <code>data/threads-storage-state.json</code> 從下方表單上傳。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="AUTO_SOCIAL_SESSION_KEY" value={threadsSession?.configured ? '已設定' : '未設定'} />
          <Info label="Session" value={threadsSession?.hasSession ? (threadsSession.healthy ? '已保存，狀態正常' : `異常：${threadsSession.healthNote ?? '未知原因'}`) : '尚未保存'} />
          <Info label="Bound Handle" value={threadsSession?.boundHandle ?? '-'} />
          <Info label="Last Login" value={threadsSession?.lastLoginAt ? formatDate(threadsSession.lastLoginAt) : '-'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshThreadsSession}>重新整理 Session</button>
          <button className="min-h-11 bg-red-700 px-4 py-2 font-bold text-white" type="button" onClick={clearThreadsSession}>清除 Session</button>
        </div>
        <div className="mt-4 border-t-2 border-asphalt pt-4 space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">兩步登入</p>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>
              在電腦的 terminal 跑：
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="block border-2 border-asphalt bg-[#fffaf2] px-3 py-2 font-mono text-sm">npm run threads:login</code>
                <button type="button" onClick={() => copyText('npm run threads:login')} className="min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-asphalt hover:text-paper">複製指令</button>
              </div>
            </li>
            <li>
              登入完成回來這裡：
              <div className="mt-1">
                <button type="button" onClick={importThreadsSessionFromFile} className="min-h-11 bg-asphalt px-4 py-2 font-bold text-paper">從 data/threads-storage-state.json 匯入</button>
              </div>
            </li>
          </ol>
        </div>
        <details className="mt-4 border-t-2 border-asphalt pt-4">
          <summary className="cursor-pointer text-sm font-bold">進階：直接貼 storageState JSON</summary>
          <form onSubmit={importThreadsSession} className="mt-3">
            <input className="mt-2 block w-full border-2 border-asphalt bg-paper p-2 text-sm" type="file" accept="application/json,.json" onChange={(e) => void loadThreadsStorageStateFile(e)} />
            <textarea className="mt-2 min-h-36 w-full border-2 border-asphalt bg-[#fffaf2] p-3 font-mono text-xs outline-none" value={threadsStorageState} onChange={(e) => setThreadsStorageState(e.target.value)} placeholder={'{"cookies":[...],"origins":[]}'} />
            <button className="mt-2 min-h-11 bg-asphalt px-4 py-2 font-bold text-paper" type="submit">加密保存 Session</button>
          </form>
        </details>
      </div>}

      {section === 'pipeline' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">AI Pipeline 狀態</h3>
        <div className="mt-3 grid gap-2 text-sm">
          <Info label="classify" value="已建立 JSON parser + StepRunner step" />
          <Info label="score" value="已建立 shouldDraft short-circuit" />
          <Info label="draft" value="已限制 exactly 3 variants + no-go 過濾" />
          <Info label="Threads" value="Playwright 搜尋優先；失敗時自動退回 site:threads.net 備援。" />
        </div>
      </div>}
    </section>
  )
}

// ─── Utility components ──────────────────────────────────────────────────────

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-signal">{label}</p><p className="mt-1 leading-relaxed">{value}</p></div>
}

function Stat({ label, value, accent }: { label: string; value: number | null; accent: string }) {
  return (
    <div className={`border-2 border-asphalt ${value === null ? 'bg-paper text-asphalt/40' : accent} py-1`}>
      <div className="text-xl font-black leading-tight">{value === null ? '—' : formatCount(value)}</div>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] opacity-70">{label}</div>
    </div>
  )
}

function Message({ text, tone, onClose }: { text: string; tone: 'notice' | 'error'; onClose: () => void }) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 border-2 border-asphalt p-3 ${tone === 'error' ? 'bg-red-100' : 'bg-[#fffaf2]'}`}>
      <span className="font-bold">{text}</span>
      <button onClick={onClose} className="font-mono text-sm">close</button>
    </div>
  )
}

// ─── Utility functions ───────────────────────────────────────────────────────

function dominantSentiment(distribution: Record<Sentiment, { count: number; pct: number }>): Sentiment | null {
  let best: Sentiment | null = null; let bestCount = 0
  for (const key of SENTIMENT_BAR_ORDER) { if (distribution[key].count > bestCount) { best = key; bestCount = distribution[key].count } }
  return best
}

function formatPct(value: number) { return `${Math.round(value * 100)}%` }

function formatCount(value: number): string {
  if (value >= 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`
  if (value >= 1_000) return `${(value / 1000).toFixed(2)}K`
  return String(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '剛剛'
  if (mins < 60) return `${mins} 分鐘前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小時前`
  return `${Math.floor(hrs / 24)} 天前`
}

function formatSchedulerStatus(status: SchedulerStatus['lastStatus']) {
  if (status === 'completed') return '完成'
  if (status === 'failed') return '有錯誤'
  if (status === 'running') return '執行中'
  if (status === 'skipped_overlap') return '略過重疊'
  return '待命中'
}

function recentTone(status: TaskStatus): string {
  if (status === 'completed') return 'bg-green-200 text-green-900'
  if (status === 'failed') return 'bg-red-200 text-red-900'
  if (status === 'cancelled') return 'bg-asphalt/30 text-asphalt'
  return 'bg-paper text-asphalt'
}

function cloudColor(index: number) { return ['#14b8a6', '#f97316', '#64748b', '#0f766e', '#94a3b8', '#d97706', '#2dd4bf'][index % 7] }
function cloudRotate(index: number) { return [-4, 2, 0, 5, -2, 3, -5][index % 7] }
function formatRadarSource(source: 'threads_playwright' | 'threads_search' | 'mixed') {
  if (source === 'threads_playwright') return 'Threads Web'
  if (source === 'threads_search') return 'site:threads.net 備援'
  return '混合'
}
function getMessage(error: unknown) { return error instanceof Error ? error.message : '操作失敗，這很難評。' }
function copyText(text: string) { void navigator.clipboard.writeText(text) }

createRoot(document.getElementById('root')!).render(<App />)
