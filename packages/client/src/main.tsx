import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import './styles.css'
import type { Candidate, CandidateStatus, KeyStatus, PatrolCard, PatrolCardDetail, RiskLevel, ThreadsSessionStatus } from './types'
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

function App() {
  const [page, setPage] = useState<'dashboard' | 'settings'>('dashboard')
  const [cards, setCards] = useState<PatrolCard[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PatrolCardDetail | null>(null)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadCards()
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
      <header className="sticky top-0 z-10 border-b-4 border-asphalt bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-signal">Social Patrol</p>
            <h1 className="font-display text-2xl font-black tracking-tight md:text-4xl">社群海巡工作站</h1>
          </div>
          <nav className="flex items-center gap-2">
            <button onClick={() => setPage('dashboard')} className={`min-h-10 border-2 border-asphalt px-3 py-1 font-bold ${page === 'dashboard' ? 'bg-asphalt text-paper' : 'bg-paper'}`}>Dashboard</button>
            <button onClick={() => setPage('settings')} className={`min-h-10 border-2 border-asphalt px-3 py-1 font-bold ${page === 'settings' ? 'bg-asphalt text-paper' : 'bg-paper'}`}>Settings</button>
            <div className="border-2 border-asphalt px-3 py-2 font-mono text-sm">v{APP_VERSION}</div>
          </nav>
        </div>
      </header>

      {page === 'settings' ? <SettingsPage /> : <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-4">
          <form onSubmit={createCard} className="border-4 border-asphalt bg-[#fffaf2] p-4 shadow-[8px_8px_0_#171717]">
            <label className="block text-sm font-bold">新增關鍵字卡</label>
            <input
              className="mt-2 min-h-12 w-full border-2 border-asphalt bg-paper px-3 text-base outline-none focus:bg-white"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="例如：中古車收購"
            />
            <button className="mt-3 min-h-11 w-full bg-asphalt px-4 py-2 font-bold text-paper transition-colors hover:bg-signal" type="submit">
              出勤海巡
            </button>
          </form>

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
          {detail ? <PatrolDetail card={detail} onRefresh={() => loadDetail(detail.id)} onThreadsScan={scanThreads} onBrowserRun={startBrowserRun} /> : <EmptyState />}
        </section>
      </section>}
    </main>
  )
}

function SettingsPage() {
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [threadsSession, setThreadsSession] = useState<ThreadsSessionStatus | null>(null)
  const [keyText, setKeyText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refreshKeys()
    void refreshThreadsSession()
  }, [])

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
      window.open(data.loginUrl, '_blank', 'noopener,noreferrer')
      setMessage(data.message)
      await refreshThreadsSession()
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

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="border-4 border-asphalt bg-[#fffaf2] p-5 shadow-[8px_8px_0_#171717]">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal">Settings / Key Pool</p>
        <h2 className="mt-1 text-4xl font-black">設定不是裝飾品</h2>
        <p className="mt-2">這頁現在可以匯入 Gemini keys、看 key pool 狀態、手動同步 key-manager。還沒做 Voice Studio，我不假裝有。</p>
      </div>

      {message && <Message tone="notice" text={message} onClose={() => setMessage(null)} />}
      {error && <Message tone="error" text={error} onClose={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
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

        <div className="border-2 border-asphalt bg-paper p-4">
          <h3 className="text-2xl font-black">AI Pipeline 狀態</h3>
          <div className="mt-3 grid gap-2 text-sm">
            <Info label="classify" value="已建立 JSON parser + StepRunner step" />
            <Info label="score" value="已建立 shouldDraft short-circuit" />
            <Info label="draft" value="已限制 exactly 3 variants + no-go 過濾" />
            <Info label="meme" value="已建立文字型 meme prompt step" />
            <Info label="Threads" value="Playwright 搜尋優先；失敗時自動退回 site:threads.net 備援。" />
            <Info label="尚未完成" value="Voice Studio、scheduler、Draft Inbox 還沒做。" />
          </div>
        </div>
      </div>

      <div className="border-2 border-asphalt bg-paper p-4">
        <h3 className="text-2xl font-black">Threads Session</h3>
        <p className="mt-1 text-sm">Phase 0 先支援唯讀搜尋。沒有 session 時會嘗試公開搜尋；失敗會自動退回 `site:threads.net` 備援。</p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="AUTO_SOCIAL_SESSION_KEY" value={threadsSession?.configured ? '已設定' : '未設定，不能保存登入 session'} />
          <Info label="Session" value={threadsSession?.hasSession ? (threadsSession.healthy ? '已保存，狀態正常' : `異常：${threadsSession.healthNote ?? '未知原因'}`) : '尚未保存'} />
          <Info label="Bound Handle" value={threadsSession?.boundHandle ?? '-'} />
          <Info label="Last Login" value={threadsSession?.lastLoginAt ? formatDate(threadsSession.lastLoginAt) : '-'} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={startThreadsSession}>開 Threads 登入頁</button>
          <button className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold" type="button" onClick={refreshThreadsSession}>重新整理 Session</button>
          <button className="min-h-11 bg-red-700 px-4 py-2 font-bold text-white" type="button" onClick={clearThreadsSession}>清除 Session</button>
        </div>
      </div>

      <div className="border-2 border-asphalt bg-[#fffaf2] p-4">
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
      </div>
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
  return <div className="border-4 border-asphalt p-10 text-center text-xl font-black">先建立一張關鍵字卡。你開心，我開心。</div>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失敗，這很難評。'
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text)
}

createRoot(document.getElementById('root')!).render(<App />)
