import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import './styles.css'
import type { AdminSession, Candidate, CandidateStatus, KeyStatus, PatrolCard, PatrolCardDetail, RadarTerm, RiskLevel, ThreadsLoginJob, ThreadsSessionStatus } from './types'
import { APP_VERSION } from './version'

const statusLabels: Record<CandidateStatus, string> = {
  useful: '值得回',
  ignored: '先放過他',
  replied: '已回覆',
  needs_follow_up: '待判斷'
}

const riskLabels: Record<RiskLevel, string> = {
  low: '低風險',
  medium: '中風險',
  high: '高風險'
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
  const [detail, setDetail] = useState<PatrolCardDetail | null>(null)
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
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId])

  async function loadCards() {
    const data = await api.listCards()
    setCards(data.cards)
    if (!selectedId && data.cards.length > 0) setSelectedId(data.cards[0].id)
  }

  async function loadDetail(cardId: string) {
    const data = await api.getCard(cardId)
    setDetail(data.card)
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
      await loadDetail(card.id)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function scanThreads() {
    if (!detail) return
    setError(null)
    try {
      const data = await api.scanThreads(detail.id)
      setNotice(data.run.message)
      await loadDetail(detail.id)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function startBrowserRun() {
    if (!detail) return
    setError(null)
    try {
      const data = await api.startBrowserRun(detail.id)
      window.open(data.run.searchUrl, '_blank', 'noopener,noreferrer')
      setNotice(data.run.message)
      await loadDetail(detail.id)
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
          {detail ? <PatrolDetail card={detail} onRefresh={() => loadDetail(detail.id)} onThreadsScan={scanThreads} onBrowserRun={startBrowserRun} /> : <EmptyState />}
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
  const [adminTokenInput, setAdminTokenInput] = useState('')
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [threadsSession, setThreadsSession] = useState<ThreadsSessionStatus | null>(null)
  const [threadsLogin, setThreadsLogin] = useState<ThreadsLoginJob | null>(null)
  const [threadsLoginText, setThreadsLoginText] = useState('')
  const [threadsScreenshotUrl, setThreadsScreenshotUrl] = useState<string | null>(null)
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

  async function loginAdmin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const data = await api.loginAdmin(adminTokenInput)
      setAdminSession(data.session)
      setAdminTokenInput('')
      setMessage('Admin session 已建立。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function logoutAdmin() {
    setError(null)
    try {
      const data = await api.logoutAdmin()
      setAdminSession(data.session)
      setKeys([])
      setMessage('Admin session 已登出。')
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
      refreshThreadsScreenshot(data.login.id)
      setMessage(data.message)
      await refreshThreadsSession()
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function clickThreadsLogin(event: React.MouseEvent<HTMLImageElement>) {
    if (!threadsLogin) return
    setError(null)
    try {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = Math.round(((event.clientX - rect.left) / rect.width) * event.currentTarget.naturalWidth)
      const y = Math.round(((event.clientY - rect.top) / rect.height) * event.currentTarget.naturalHeight)
      const data = await api.clickThreadsLogin(threadsLogin.id, x, y)
      setThreadsLogin(data.login)
      refreshThreadsScreenshot(data.login.id)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function typeThreadsLogin() {
    if (!threadsLogin || !threadsLoginText) return
    setError(null)
    try {
      const data = await api.typeThreadsLogin(threadsLogin.id, threadsLoginText)
      setThreadsLoginText('')
      setThreadsLogin(data.login)
      refreshThreadsScreenshot(data.login.id)
    } catch (err) {
      setError(getMessage(err))
    }
  }

  async function pressThreadsLogin(key: 'Enter' | 'Tab' | 'Escape' | 'Backspace') {
    if (!threadsLogin) return
    setError(null)
    try {
      const data = await api.pressThreadsLogin(threadsLogin.id, key)
      setThreadsLogin(data.login)
      refreshThreadsScreenshot(data.login.id)
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
      setThreadsScreenshotUrl(null)
      setMessage('Threads session 已加密保存。現在可以掃描真實 Threads 雷達。')
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
      setThreadsScreenshotUrl(null)
      setMessage('Threads 登入已取消。')
    } catch (err) {
      setError(getMessage(err))
    }
  }

  function refreshThreadsScreenshot(jobId = threadsLogin?.id) {
    if (!jobId) return
    setThreadsScreenshotUrl(api.getThreadsLoginScreenshotUrl(jobId))
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

      {section === 'admin' && <form onSubmit={loginAdmin} className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Admin Login</h3>
        <p className="mt-1 text-sm">`ADMIN_TOKEN` 已在伺服器環境設定；這裡只用它登入後端 admin session。Token 不存 localStorage，登入成功後由 HttpOnly cookie 授權。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="ADMIN_TOKEN" value={adminSession?.configured ? 'server 已設定' : 'server 未設定'} />
          <Info label="Admin Session" value={adminSession?.authenticated ? '已登入' : '未登入'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="min-h-11 min-w-0 flex-1 border-2 border-asphalt bg-[#fffaf2] px-3 text-base outline-none"
            value={adminTokenInput}
            onChange={(event) => setAdminTokenInput(event.target.value)}
            placeholder="貼上 ADMIN_TOKEN"
            type="password"
          />
          <button className="min-h-11 bg-asphalt px-4 py-2 font-bold text-paper" type="submit">登入 Admin</button>
          {adminSession?.authenticated && <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={logoutAdmin}>登出</button>}
        </div>
      </form>}

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
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Headless Login</p>
                <p className="text-sm">這是後端真瀏覽器畫面，不是 iframe。起點是 Instagram 登入頁；用下方輸入框送 IG 帳號、密碼或驗證碼。登入成功跳回 Threads 後，按「完成並保存」。</p>
                <p className="mt-1 break-all font-mono text-xs text-asphalt/60">{threadsLogin.url}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="min-h-10 border-2 border-asphalt px-3 py-1 font-bold" type="button" onClick={() => refreshThreadsScreenshot()}>刷新截圖</button>
                <button className="min-h-10 bg-asphalt px-3 py-1 font-bold text-paper" type="button" onClick={finishThreadsLogin}>完成並保存</button>
                <button className="min-h-10 bg-red-700 px-3 py-1 font-bold text-white" type="button" onClick={cancelThreadsLogin}>取消</button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="min-h-11 min-w-0 flex-1 border-2 border-asphalt bg-[#fffaf2] px-3 text-base outline-none"
                value={threadsLoginText}
                onChange={(event) => setThreadsLoginText(event.target.value)}
                placeholder="點截圖中的欄位後，在這裡輸入 IG 帳號、密碼或驗證碼"
                type="password"
              />
              <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={typeThreadsLogin}>送出文字</button>
              <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={() => void pressThreadsLogin('Enter')}>Enter</button>
              <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={() => void pressThreadsLogin('Tab')}>Tab</button>
              <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={() => void pressThreadsLogin('Backspace')}>Backspace</button>
            </div>
            {threadsScreenshotUrl && (
              <div className="mt-3 overflow-hidden border-2 border-asphalt bg-black">
                <img src={threadsScreenshotUrl} onClick={clickThreadsLogin} className="block w-full cursor-crosshair" alt="Threads login browser screenshot" />
              </div>
            )}
          </div>
        )}
        <form onSubmit={importThreadsSession} className="mt-4 border-t-2 border-asphalt pt-4">
          <label className="text-sm font-bold">匯入 Playwright storageState JSON</label>
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

function PatrolDetail({ card, onRefresh, onThreadsScan, onBrowserRun }: { card: PatrolCardDetail; onRefresh: () => void; onThreadsScan: () => void; onBrowserRun: () => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function addCandidate(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await api.addCandidate(card.id, url, title, excerpt)
      setUrl('')
      setTitle('')
      setExcerpt('')
      onRefresh()
    } catch (err) {
      setError(getMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="border-4 border-asphalt bg-[#fffaf2] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Keyword Card</p>
            <h2 className="mt-1 text-4xl font-black">{card.keyword}</h2>
            <p className="mt-2 text-sm">海巡隊已就位。等情報進來。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onThreadsScan} className="min-h-11 bg-signal px-4 py-2 font-bold text-white transition-colors hover:bg-asphalt">
              Threads 出勤海巡
            </button>
            <button onClick={onBrowserRun} className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold transition-colors hover:bg-asphalt hover:text-paper">
              開 Threads 搜尋
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={addCandidate} className="grid gap-3 border-2 border-asphalt p-4 md:grid-cols-[1.5fr_1fr]">
        <div className="md:col-span-2">
          <label className="text-sm font-bold">手動加入 Threads 連結</label>
          <input className="mt-1 min-h-11 w-full border-2 border-asphalt bg-paper px-3 text-base" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.threads.net/..." />
        </div>
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="標題，可空白" />
        <input className="min-h-11 border-2 border-asphalt bg-paper px-3 text-base" value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="摘錄，可空白" />
        <button className="min-h-11 bg-signal px-4 py-2 font-black text-white md:col-span-2" type="submit">加入結果並產生建議</button>
        {error && <p className="text-sm font-bold text-red-700 md:col-span-2">{error}</p>}
      </form>

      <div className="grid gap-4 xl:grid-cols-2">
        {card.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onRefresh={onRefresh} />)}
        {card.candidates.length === 0 && <div className="border-2 border-dashed border-asphalt p-8 text-center">目前還沒有結果。靠，海巡隊剛穿鞋。</div>}
      </div>
    </div>
  )
}

function CandidateCard({ candidate, onRefresh }: { candidate: Candidate; onRefresh: () => void }) {
  async function setStatus(status: CandidateStatus) {
    await api.updateCandidateStatus(candidate.id, status)
    onRefresh()
  }

  return (
    <article className="border-4 border-asphalt bg-[#fffaf2] p-4 shadow-[6px_6px_0_#171717]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">{candidate.source}</p>
          <h3 className="mt-1 text-xl font-black">{candidate.title || 'Threads 連結待確認'}</h3>
        </div>
        <span className="border-2 border-asphalt px-2 py-1 text-xs font-bold">{statusLabels[candidate.status]}</span>
      </div>
      <a className="mt-2 block break-all text-sm underline" href={candidate.url} target="_blank" rel="noreferrer">{candidate.url}</a>
      {candidate.excerpt && <p className="mt-3 border-l-4 border-signal pl-3">{candidate.excerpt}</p>}

      {candidate.analysis && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <Info label="值不值得回" value={candidate.analysis.worthReplying ? '可以，請保持優雅又欠揍' : '先不要，這可能會變售後地獄'} />
            <Info label="風險" value={`${riskLabels[candidate.analysis.riskLevel]}：${candidate.analysis.riskNote}`} />
          </div>
          <Info label="摘要" value={candidate.analysis.summary} />
          <Info label="回覆角度" value={candidate.analysis.replyAngle} />
          <Info label="圖片建議" value={candidate.analysis.imageIdea} />
          <Info label="迷因圖卡 Prompt" value={candidate.analysis.memePrompt} />
          <div className="space-y-2">
            {candidate.analysis.suggestions.map((suggestion) => (
              <div key={suggestion.id} className="border-2 border-asphalt bg-paper p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong>{suggestion.label}</strong>
                  <span className="font-mono text-xs">{riskLabels[suggestion.riskLevel]}</span>
                </div>
                <p>{suggestion.text}</p>
                <button onClick={() => copyText(suggestion.text)} className="mt-2 min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-asphalt hover:text-paper">
                  複製回覆
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={candidate.url} target="_blank" rel="noreferrer" className="min-h-10 bg-asphalt px-3 py-2 text-sm font-bold text-paper">開啟 Threads</a>
        {(['useful', 'ignored', 'replied', 'needs_follow_up'] as CandidateStatus[]).map((status) => (
          <button key={status} onClick={() => setStatus(status)} className="min-h-10 border-2 border-asphalt px-3 py-1 text-sm font-bold hover:bg-signal hover:text-white">
            {statusLabels[status]}
          </button>
        ))}
      </div>
    </article>
  )
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
