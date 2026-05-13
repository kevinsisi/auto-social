import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import './styles.css'
import type { AdminSession, FeedbackDecision, KeyStatus, KeywordObservation, ObservedPost, PatrolCard, RadarTerm, Sentiment, SponsoredSignal, ThreadsLoginJob, ThreadsSessionStatus } from './types'
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

type Page = 'dashboard' | 'settings'
type SettingsSection = 'admin' | 'keys' | 'threads' | 'pipeline'

function navigate(path: string) {
  window.location.hash = path
}

function getPageFromHash(): Page {
  return window.location.hash.startsWith('#settings') ? 'settings' : 'dashboard'
}

function getSettingsSection(): SettingsSection {
  const section = window.location.hash.replace(/^#settings\/?/, '')
  if (section === 'keys' || section === 'threads' || section === 'pipeline') return section
  return 'admin'
}

function App() {
  const [page, setPage] = useState<'dashboard' | 'settings'>(() => getPageFromHash())
  const [cards, setCards] = useState<PatrolCard[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [observation, setObservation] = useState<KeywordObservation | null>(null)
  const [observationLoading, setObservationLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [radarTerms, setRadarTerms] = useState<RadarTerm[]>([])
  const [radarLoading, setRadarLoading] = useState(false)
  const [radarMeta, setRadarMeta] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadCards()
    void loadRadarTrends()
    const onHashChange = () => setPage(getPageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setObservation(null)
      return
    }
    void loadObservation(selectedId)
    const id = window.setInterval(() => void loadObservation(selectedId), 30_000)
    return () => window.clearInterval(id)
  }, [selectedId])

  async function loadCards() {
    const data = await api.listCards()
    setCards(data.cards)
    if (!selectedId && data.cards.length > 0) setSelectedId(data.cards[0].id)
  }

  async function loadObservation(cardId: string) {
    setObservationLoading(true)
    try {
      const data = await api.getKeywordObservation(cardId)
      setObservation(data.observation)
    } catch (err) {
      setObservation(null)
      setError(getMessage(err))
    } finally {
      setObservationLoading(false)
    }
  }

  async function loadRadarTrends() {
    setRadarLoading(true)
    try {
      const data = await api.getRadarTrends()
      setRadar(data.radar)
    } catch (err) {
      setRadarTerms([])
      setRadarMeta(getMessage(err))
    } finally {
      setRadarLoading(false)
    }
  }

  async function runRadarScan() {
    setRadarLoading(true)
    try {
      const data = await api.runRadarScan()
      setRadar(data.radar)
    } catch (err) {
      setRadarTerms([])
      setRadarMeta(getMessage(err))
    } finally {
      setRadarLoading(false)
    }
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
      setSelectedId(data.card.id)
      setNotice('海巡卡建立好了。只好讓我來幫幫你了。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function monitorRadarTerm(term: string) {
    setError(null)
    setNotice(null)
    try {
      const existing = cards.find((card) => card.keyword === term)
      const card = existing ?? (await api.createCard(term)).card
      setKeyword('')
      await loadCards()
      setSelectedId(card.id)
      const data = await api.scanThreads(card.id)
      setNotice(`已把「${term}」加入監控並出勤。${data.run.message}`)
      await loadObservation(card.id)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function scanThreads() {
    if (!selectedId) return
    setError(null)
    try {
      const data = await api.scanThreads(selectedId)
      setNotice(`${data.run.message} AI 正在背景判讀；30 秒內會自動刷新。`)
      await loadObservation(selectedId)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function addManualLink(url: string, title: string, excerpt: string) {
    if (!selectedId) return
    setError(null)
    try {
      await api.addCandidate(selectedId, url, title, excerpt)
      setNotice('手動連結已加入，但目前僅進入舊管線；AI 風向觀察以排程結果為主。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function submitFeedback(post: ObservedPost, decision: FeedbackDecision, comment?: string) {
    if (!post.draft) return
    try {
      await api.submitVoiceFeedback({ draftId: post.id, variantIdx: post.draft.variantIdx, decision, comment })
      setNotice(decision === 'rewrite' ? '改寫意見收到，會餵進 voice 訓練。' : '紀錄了你的回饋。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  return (
    <main className="min-h-screen bg-paper text-asphalt">
      <header className="sticky top-0 z-10 border-b-4 border-asphalt bg-paper/95 px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.28em] text-signal sm:text-xs sm:tracking-[0.35em]">Social Patrol</p>
            <h1 className="font-display text-3xl font-black leading-none tracking-tight sm:whitespace-nowrap sm:text-2xl md:text-4xl">社群海巡工作站</h1>
          </div>
          <nav className="grid grid-cols-[1fr_1fr_auto] items-stretch gap-2 sm:flex sm:items-center">
            <button onClick={() => navigate('dashboard')} className={`min-h-10 border-2 border-asphalt px-2 py-1 text-sm font-bold sm:px-3 sm:text-base ${page === 'dashboard' ? 'bg-asphalt text-paper' : 'bg-paper'}`}>Dashboard</button>
            <button onClick={() => navigate('settings/admin')} className={`min-h-10 border-2 border-asphalt px-2 py-1 text-sm font-bold sm:px-3 sm:text-base ${page === 'settings' ? 'bg-asphalt text-paper' : 'bg-paper'}`}>Settings</button>
            <div className="flex min-h-10 items-center border-2 border-asphalt px-2 py-1 font-mono text-xs sm:px-3 sm:py-2 sm:text-sm">v{APP_VERSION}</div>
          </nav>
        </div>
      </header>

      {page === 'settings' ? <SettingsPage /> : <section className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-4 sm:py-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4 lg:order-first">
          <form onSubmit={createCard} className="border-4 border-asphalt bg-[#fffaf2] p-4 shadow-[5px_5px_0_#171717] sm:shadow-[8px_8px_0_#171717]">
            <label className="block text-sm font-bold">新增監控關鍵字</label>
            <input
              className="mt-2 min-h-12 w-full border-2 border-asphalt bg-paper px-3 text-base outline-none focus:bg-white"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="例如：AI 小編、Threads 經營"
            />
            <button className="mt-3 min-h-11 w-full bg-asphalt px-4 py-2 font-bold text-paper transition-colors hover:bg-signal" type="submit">
              加入監控雷達
            </button>
          </form>

          <div className="border-2 border-asphalt bg-paper p-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Watchlist</p>
            <h2 className="text-xl font-black">關鍵字監控</h2>
            <p className="mt-1 text-xs">雷達會自動觀察；這裡是你想加強盯防的巡邏線。</p>
          </div>

          <div className="space-y-2">
            {cards.map((card) => (
              <button
                key={card.id}
                onClick={() => setSelectedId(card.id)}
                className={`w-full border-2 p-3 text-left transition-colors ${selectedId === card.id ? 'border-signal bg-asphalt text-paper' : 'border-asphalt bg-paper hover:bg-[#fffaf2]'}`}
              >
                <div className="text-lg font-black">{card.keyword}</div>
                <div className="font-mono text-xs opacity-70">{formatDate(card.updatedAt)}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          {notice && <Message tone="notice" text={notice} onClose={() => setNotice(null)} />}
          {error && <Message tone="error" text={error} onClose={() => setError(null)} />}
          <HotKeywordCloud terms={radarTerms} loading={radarLoading} meta={radarMeta} onRefresh={runRadarScan} onSelect={(keyword) => void monitorRadarTerm(keyword)} />
          {selectedId
            ? <KeywordObservationPanel observation={observation} loading={observationLoading} onScanThreads={scanThreads} onAddManualLink={addManualLink} onFeedback={submitFeedback} />
            : <EmptyState />}
        </section>
      </section>}
    </main>
  )
}

function HotKeywordCloud({ terms, loading, meta, onRefresh, onSelect }: { terms: RadarTerm[]; loading: boolean; meta: string | null; onRefresh: () => void; onSelect: (keyword: string) => void }) {
  const max = Math.max(1, ...terms.map((term) => term.count))
  return (
    <section className="relative overflow-hidden border-4 border-asphalt bg-white p-4 shadow-[5px_5px_0_#171717] sm:p-5 sm:shadow-[8px_8px_0_#171717]">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-signal">Patrol Radar</p>
          <h2 className="text-3xl font-black sm:text-4xl">熱門關鍵字雲</h2>
          {meta && <p className="mt-1 font-mono text-xs text-asphalt/60">{meta}</p>}
        </div>
        <div className="max-w-xl space-y-2 text-sm">
          <p>只顯示已寫入資料庫的 Threads 實際候選抽詞；抓不到就留空，不再用罐頭詞補畫面。點詞會直接加入監控並出勤。</p>
          <button type="button" onClick={onRefresh} className="min-h-9 border-2 border-asphalt px-3 py-1 font-bold hover:bg-signal hover:text-white" disabled={loading}>{loading ? '掃描中' : '掃描 Threads 雷達'}</button>
        </div>
      </div>
      <div className="mt-5 min-h-[240px] rounded-[1.5rem] border-2 border-dashed border-asphalt/25 bg-[radial-gradient(circle_at_center,#fffaf2,white_62%)] p-3 sm:min-h-[270px] sm:rounded-[2rem] sm:p-5">
        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center text-center text-xl font-black text-asphalt/50">正在掃描 Threads 並寫入候選資料...</div>
        ) : terms.length > 0 ? (
          <div className="flex h-full flex-wrap items-center justify-center gap-x-4 gap-y-2 leading-none">
            {terms.map((term, index) => (
              <button
                key={`${term.word}-${index}`}
                type="button"
                onClick={() => onSelect(term.word)}
                className="font-black transition-transform hover:scale-110"
                style={{ color: cloudColor(index), fontSize: `${Math.round(16 + (term.count / max) * 42)}px`, transform: `rotate(${cloudRotate(index)}deg)` }}
                title={`出現 ${term.count} 次`}
              >
                {term.word}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center text-center text-xl font-black text-asphalt/50">最近 24 小時還沒有可用的 Threads 實際詞，請掃描雷達或先匯入 Threads session。</div>
        )}
      </div>
    </section>
  )
}

function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>(() => getSettingsSection())
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [threadsSession, setThreadsSession] = useState<ThreadsSessionStatus | null>(null)
  const [threadsLogin, setThreadsLogin] = useState<ThreadsLoginJob | null>(null)
  const [threadsLoginText, setThreadsLoginText] = useState('')
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
    if (adminSession?.authenticated) void refreshKeys()
  }, [adminSession?.authenticated])

  async function refreshAdminSession() {
    try {
      const data = await api.getAdminSession()
      setAdminSession(data.session)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function refreshKeys() {
    try {
      const data = await api.getKeyStatus()
      setKeys(data.keys)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function importKeys(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await api.importKeys(keyText)
      setMessage(`新增 ${result.inserted} 把、重複略過 ${result.duplicate} 把。`)
      setKeyText('')
      await refreshKeys()
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function syncKeys() {
    setError(null)
    try {
      const result = await api.syncKeys()
      setMessage(result.synced ? `已從 key-manager 同步 ${result.imported} 把。${result.warning ?? ''}` : result.warning)
      await refreshKeys()
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function refreshThreadsSession() {
    try {
      const data = await api.getThreadsSessionStatus()
      setThreadsSession(data.session)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function startThreadsSession() {
    setError(null)
    try {
      const data = await api.startThreadsSession()
      setThreadsLogin(data.login)
      setMessage(data.message)
      await refreshThreadsSession()
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function finishThreadsLogin() {
    if (!threadsLogin) return
    setError(null)
    try {
      const data = await api.finishThreadsLogin(threadsLogin.id)
      setThreadsSession(data.session)
      setThreadsLogin(null)
      setMessage('Threads session 已加密保存。現在可以掃描真實 Threads 雷達。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function submitRemoteText(event: React.FormEvent) {
    event.preventDefault()
    if (!threadsLogin || !threadsLoginText) return
    setError(null)
    try {
      const data = await api.typeThreadsLogin(threadsLogin.id, threadsLoginText)
      setThreadsLogin(data.login)
      setThreadsLoginText('')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function pressRemoteKey(key: 'Enter' | 'Tab' | 'Escape' | 'Backspace') {
    if (!threadsLogin) return
    setError(null)
    try {
      const data = await api.pressThreadsLogin(threadsLogin.id, key)
      setThreadsLogin(data.login)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function cancelThreadsLogin() {
    if (!threadsLogin) return
    setError(null)
    try {
      const data = await api.cancelThreadsLogin(threadsLogin.id)
      setThreadsSession(data.session)
      setThreadsLogin(null)
      setMessage('Threads 登入已取消。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function clearThreadsSession() {
    setError(null)
    try {
      const data = await api.clearThreadsSession()
      setThreadsSession(data.session)
      setMessage('Threads session 已清除。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function importThreadsSession(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const data = await api.importThreadsSession(threadsStorageState)
      setThreadsSession(data.session)
      setThreadsStorageState('')
      setMessage('Threads storageState 已加密保存。下次海巡會優先帶 session 搜尋。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function loadThreadsStorageStateFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setThreadsStorageState(await file.text())
      setMessage('已載入 storageState JSON，請按「加密保存 Session」。')
    } catch (err) {
      setError(getMessage(err))
    } finally {
      event.target.value = ''
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="border-4 border-asphalt bg-[#fffaf2] p-5 shadow-[8px_8px_0_#171717]">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Settings / {section}</p>
        <h2 className="mt-1 text-4xl font-black">設定不是裝飾品</h2>
        <p className="mt-2">設定已拆成路由：Admin、Key Pool、Threads Session、Pipeline。不是全部堆在同一頁。</p>
      </div>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['admin', 'keys', 'threads', 'pipeline'] as SettingsSection[]).map((item) => (
          <button key={item} type="button" onClick={() => navigate(`settings/${item}`)} className={`min-h-11 border-2 border-asphalt px-3 py-2 font-bold ${section === item ? 'bg-asphalt text-paper' : 'bg-paper'}`}>
            {item}
          </button>
        ))}
      </nav>

      {message && <Message tone="notice" text={message} onClose={() => setMessage(null)} />}
      {error && <Message tone="error" text={error} onClose={() => setError(null)} />}

      {section === 'admin' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Admin 狀態</h3>
        <p className="mt-1 text-sm">`ADMIN_TOKEN` 已由部署環境設定。這是單人 homelab 服務，UI 不再要求你貼 token；管理路由由 server-side 單人模式放行。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="ADMIN_TOKEN" value={adminSession?.configured ? 'server 已設定' : 'server 未設定'} />
          <Info label="Admin Access" value={adminSession?.authenticated ? '已可操作' : '不可操作'} />
        </div>
        <button className="mt-3 min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshAdminSession}>重新檢查</button>
      </div>}

      {section === 'keys' && <div className="grid gap-4">
        <form onSubmit={importKeys} className="border-2 border-asphalt bg-paper p-4">
          <h3 className="text-2xl font-black">Key Pool 匯入</h3>
          <p className="mt-1 text-sm">一行一把 Gemini key，`#` 開頭會略過。沒有 key，AI pipeline 就只是骨架。</p>
          <textarea
            className="mt-3 min-h-48 w-full border-2 border-asphalt bg-[#fffaf2] p-3 font-mono text-sm outline-none"
            value={keyText}
            onChange={(event) => setKeyText(event.target.value)}
            placeholder={'# paste keys here\nAIza...'}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="min-h-11 bg-asphalt px-4 py-2 font-bold text-paper" type="submit">匯入 keys</button>
            <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={syncKeys}>從 key-manager 同步</button>
            <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshKeys}>重新整理</button>
          </div>
        </form>
      </div>}

      {section === 'threads' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Threads Session</h3>
        <p className="mt-1 text-sm">Phase 0 先支援唯讀搜尋。可貼上 Playwright storageState JSON 保存 session；沒有 session 時會嘗試公開搜尋，失敗退回 `site:threads.net` 備援。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="AUTO_SOCIAL_SESSION_KEY" value={threadsSession?.configured ? '已設定' : '未設定，不能保存登入 session'} />
          <Info label="Session" value={threadsSession?.hasSession ? (threadsSession.healthy ? '已保存，狀態正常' : `異常：${threadsSession.healthNote ?? '未知原因'}`) : '尚未保存'} />
          <Info label="Bound Handle" value={threadsSession?.boundHandle ?? '-'} />
          <Info label="Last Login" value={threadsSession?.lastLoginAt ? formatDate(threadsSession.lastLoginAt) : '-'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={startThreadsSession}>互動登入 Threads</button>
          <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshThreadsSession}>重新整理 Session</button>
          <button className="min-h-11 bg-red-700 px-4 py-2 font-bold text-white" type="button" onClick={clearThreadsSession}>清除 Session</button>
        </div>
        {threadsLogin && (
          <div className="mt-4 border-t-2 border-asphalt pt-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Remote Browser</p>
                <p className="text-sm">這是容器內的真 Chromium。iOS 不會替 noVNC canvas 跳鍵盤；先點遠端瀏覽器欄位，再用下方「手機鍵盤輸入」送字到目前 focus 的欄位。</p>
                <p className="mt-1 break-all font-mono text-xs text-asphalt/60">{threadsLogin.url}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="min-h-10 bg-asphalt px-3 py-1 font-bold text-paper" type="button" onClick={finishThreadsLogin}>完成並保存</button>
                <button className="min-h-10 bg-red-700 px-3 py-1 font-bold text-white" type="button" onClick={cancelThreadsLogin}>取消</button>
              </div>
            </div>
            <form onSubmit={submitRemoteText} className="sticky bottom-2 z-20 mt-3 border-2 border-asphalt bg-paper p-2 shadow-[4px_4px_0_#171717]">
              <label className="text-xs font-bold">手機鍵盤輸入到遠端瀏覽器</label>
              <input
                className="mt-1 min-h-12 w-full border-2 border-asphalt bg-[#fffaf2] px-3 text-base outline-none"
                value={threadsLoginText}
                onChange={(event) => setThreadsLoginText(event.target.value)}
                placeholder="先點遠端欄位，再在這裡輸入帳號、密碼或驗證碼"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
              />
              <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button className="min-h-11 border-2 border-asphalt px-3 py-2 font-bold" type="submit">送到遠端</button>
                <button className="min-h-11 border-2 border-asphalt px-3 py-2 font-bold" type="button" onClick={() => void pressRemoteKey('Enter')}>Enter</button>
                <button className="min-h-11 border-2 border-asphalt px-3 py-2 font-bold" type="button" onClick={() => void pressRemoteKey('Tab')}>Tab 下一欄</button>
                <button className="min-h-11 border-2 border-asphalt px-3 py-2 font-bold" type="button" onClick={() => void pressRemoteKey('Backspace')}>Backspace</button>
              </div>
            </form>
            <div className="mt-3 overflow-hidden border-2 border-asphalt bg-black">
              <iframe src={threadsLogin.vncUrl} className="h-[70vh] w-full" title="Remote browser login" />
            </div>
          </div>
        )}
        <form onSubmit={importThreadsSession} className="mt-4 border-t-2 border-asphalt pt-4">
          <label className="text-sm font-bold">匯入 Playwright storageState JSON</label>
          <p className="mt-1 text-sm">電腦執行 `npm run threads:login`，登入完成後上傳 `data/threads-storage-state.json`。</p>
          <input className="mt-2 block w-full border-2 border-asphalt bg-paper p-2 text-sm" type="file" accept="application/json,.json" onChange={(event) => void loadThreadsStorageStateFile(event)} />
          <textarea
            className="mt-2 min-h-36 w-full border-2 border-asphalt bg-[#fffaf2] p-3 font-mono text-xs outline-none"
            value={threadsStorageState}
            onChange={(event) => setThreadsStorageState(event.target.value)}
            placeholder={'{"cookies":[...],"origins":[...]}' }
          />
          <button className="mt-2 min-h-11 bg-asphalt px-4 py-2 font-bold text-paper" type="submit">加密保存 Session</button>
        </form>
      </div>}

      {section === 'keys' && <div className="border-2 border-asphalt bg-[#fffaf2] p-4">
        <h3 className="text-2xl font-black">目前 keys</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-asphalt">
                <th className="p-2">ID</th>
                <th className="p-2">Suffix</th>
                <th className="p-2">Health</th>
                <th className="p-2">Usage</th>
                <th className="p-2">Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-asphalt/30">
                  <td className="p-2 font-mono">{key.id}</td>
                  <td className="p-2 font-mono">...{key.suffix}</td>
                  <td className="p-2 font-bold">{key.health}</td>
                  <td className="p-2">{key.usageCount}</td>
                  <td className="p-2">{key.cooldownUntil ? formatDate(new Date(key.cooldownUntil).toISOString()) : '-'}</td>
                </tr>
              ))}
              {keys.length === 0 && <tr><td className="p-4 text-center" colSpan={5}>目前沒有 key。AI 小編還沒拿到筆。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>}

      {section === 'pipeline' && <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">AI Pipeline 狀態</h3>
        <div className="mt-3 grid gap-2 text-sm">
          <Info label="classify" value="已建立 JSON parser + StepRunner step" />
          <Info label="score" value="已建立 shouldDraft short-circuit" />
          <Info label="draft" value="已限制 exactly 3 variants + no-go 過濾" />
          <Info label="meme" value="已建立文字型 meme prompt step" />
          <Info label="Threads" value="Playwright 搜尋優先；失敗時自動退回 site:threads.net 備援。" />
          <Info label="尚未完成" value="Voice Studio、scheduler、Draft Inbox 還沒做。" />
        </div>
      </div>}
    </section>
  )
}

function KeywordObservationPanel({ observation, loading, onScanThreads, onAddManualLink, onFeedback }: {
  observation: KeywordObservation | null
  loading: boolean
  onScanThreads: () => void
  onAddManualLink: (url: string, title: string, excerpt: string) => Promise<void>
  onFeedback: (post: ObservedPost, decision: FeedbackDecision, comment?: string) => Promise<void>
}) {
  if (!observation) {
    return <div className="border-4 border-asphalt p-8 text-center text-lg font-black sm:p-10">{loading ? '正在讀取觀察站資料...' : '請先選一個關鍵字，或點上方雷達中的詞加入監控。'}</div>
  }
  const { card, aggregate, posts } = observation
  const dominant = useMemo(() => dominantSentiment(aggregate.sentimentDistribution), [aggregate.sentimentDistribution])

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
              主要情緒：{dominant ? `${SENTIMENT_LABELS[dominant]}` : '尚不足判斷'}
              {aggregate.pipelineBlockedCount > 0 ? ` · ${aggregate.pipelineBlockedCount} 則 AI 判讀失敗` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onScanThreads} className="min-h-11 bg-signal px-4 py-2 font-bold text-white transition-colors hover:bg-asphalt">
              Threads 出勤海巡
            </button>
          </div>
        </div>
        <SentimentBar distribution={aggregate.sentimentDistribution} classifiedSamples={aggregate.classifiedSamples} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {posts.map((post) => <ObservedPostCard key={post.id} post={post} onFeedback={onFeedback} />)}
        {posts.length === 0 && (
          <div className="border-2 border-dashed border-asphalt p-8 text-center xl:col-span-2">
            尚無樣本。按上方「Threads 出勤海巡」抓一輪，或等下一次自動排程。
          </div>
        )}
      </div>

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
            <div
              key={key}
              className="flex items-center justify-center text-xs font-black text-white"
              style={{ width: `${Math.max(bucket.pct * 100, 4)}%`, background: SENTIMENT_COLORS[key] }}
              title={`${SENTIMENT_LABELS[key]} ${bucket.count} 則 (${formatPct(bucket.pct)})`}
            >
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

function ObservedPostCard({ post, onFeedback }: { post: ObservedPost; onFeedback: (post: ObservedPost, decision: FeedbackDecision, comment?: string) => Promise<void> }) {
  const [expandedReasons, setExpandedReasons] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [rewriteText, setRewriteText] = useState('')
  const [lastDecision, setLastDecision] = useState<FeedbackDecision | null>(null)
  const sponsoredBadge = post.sponsoredSignal ?? null
  const sponsoredClass = sponsoredBadge ? SPONSORED_TONE[sponsoredBadge] : 'border-asphalt bg-paper'

  return (
    <article className="border-4 border-asphalt bg-[#fffaf2] p-4 shadow-[6px_6px_0_#171717]">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">{post.author ?? '匿名作者'} · {post.source}</p>
          <a className="mt-1 block break-all text-sm underline" href={post.url} target="_blank" rel="noreferrer">{post.url}</a>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
          {post.postedAt && <span className="border-2 border-asphalt px-2 py-1">{formatDate(post.postedAt)}</span>}
          {post.likes !== null && <span className="border-2 border-asphalt px-2 py-1">♥ {post.likes}</span>}
          {post.replyCount !== null && <span className="border-2 border-asphalt px-2 py-1">↩ {post.replyCount}</span>}
        </div>
      </header>

      <p className="mt-3 whitespace-pre-line border-l-4 border-signal pl-3 text-sm">{post.excerpt}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
        {post.sentiment ? (
          <span className="border-2 border-asphalt px-2 py-1 text-white" style={{ background: SENTIMENT_COLORS[post.sentiment] }}>
            {SENTIMENT_LABELS[post.sentiment]}
          </span>
        ) : (
          <span className="border-2 border-asphalt px-2 py-1 bg-paper">情緒判讀中</span>
        )}
        {post.topic && <span className="border-2 border-asphalt px-2 py-1 bg-paper">主題：{post.topic}</span>}
        {sponsoredBadge && (
          <button type="button" onClick={() => setExpandedReasons((v) => !v)} className={`border-2 px-2 py-1 ${sponsoredClass}`}>
            {SPONSORED_LABELS[sponsoredBadge]} {post.sponsoredReasons.length > 0 ? (expandedReasons ? '▲' : '▼') : ''}
          </button>
        )}
        {post.pipelineStatus === 'pipeline_blocked' && <span className="border-2 border-red-600 bg-red-100 px-2 py-1 text-red-700">AI 判讀失敗</span>}
      </div>
      {expandedReasons && post.sponsoredReasons.length > 0 && (
        <ul className="mt-2 list-disc border-2 border-asphalt bg-paper p-3 pl-6 text-sm">
          {post.sponsoredReasons.map((reason, idx) => <li key={idx}>{reason}</li>)}
        </ul>
      )}

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
              <form
                className="mt-3 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!rewriteText.trim()) return
                  setLastDecision('rewrite')
                  void onFeedback(post, 'rewrite', rewriteText.trim())
                  setRewriteText('')
                  setRewriting(false)
                }}
              >
                <textarea
                  className="min-h-20 w-full border-2 border-asphalt bg-[#fffaf2] p-2 text-sm"
                  placeholder="這版怎樣改才更像我？"
                  value={rewriteText}
                  onChange={(event) => setRewriteText(event.target.value)}
                />
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    await onSubmit(url.trim(), title.trim(), excerpt.trim())
    setUrl('')
    setTitle('')
    setExcerpt('')
  }

  return (
    <form onSubmit={submit} className="border-2 border-dashed border-asphalt p-4">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Manual Backup</p>
      <h3 className="mt-1 text-lg font-black">手動加 Threads 連結（備援）</h3>
      <p className="mt-1 text-sm">出勤海巡沒抓到、又想觀察特定貼文時用；AI 風向以排程結果為主。</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[1.5fr_1fr_1fr_auto]">
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.threads.net/..." />
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="標題（可空）" />
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="摘錄（可空）" />
        <button className="min-h-11 bg-signal px-4 py-2 font-bold text-white" type="submit">加入</button>
      </div>
    </form>
  )
}

function dominantSentiment(distribution: Record<Sentiment, { count: number; pct: number }>): Sentiment | null {
  let best: Sentiment | null = null
  let bestCount = 0
  for (const key of SENTIMENT_BAR_ORDER) {
    if (distribution[key].count > bestCount) {
      best = key
      bestCount = distribution[key].count
    }
  }
  return best
}

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-signal">{label}</p><p className="mt-1 leading-relaxed">{value}</p></div>
}

function Message({ text, tone, onClose }: { text: string; tone: 'notice' | 'error'; onClose: () => void }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-2 border-asphalt p-3 ${tone === 'error' ? 'bg-red-100' : 'bg-[#fffaf2]'}`}>
      <span className="font-bold">{text}</span>
      <button onClick={onClose} className="font-mono text-sm">close</button>
    </div>
  )
}

function EmptyState() {
  return <div className="border-4 border-asphalt p-8 text-center text-lg font-black sm:p-10 sm:text-xl">自動雷達已啟動。你可以加關鍵字強化監控，也可以先看上方趨勢雲。</div>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function cloudColor(index: number) {
  return ['#14b8a6', '#f97316', '#64748b', '#0f766e', '#94a3b8', '#d97706', '#2dd4bf'][index % 7]
}

function cloudRotate(index: number) {
  return [-4, 2, 0, 5, -2, 3, -5][index % 7]
}

function formatRadarSource(source: 'threads_playwright' | 'threads_search' | 'mixed') {
  if (source === 'threads_playwright') return 'Threads Web'
  if (source === 'threads_search') return 'site:threads.net 備援'
  return '混合'
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失敗，這很難評。'
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text)
}

createRoot(document.getElementById('root')!).render(<App />)
