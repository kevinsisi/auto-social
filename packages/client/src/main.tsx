import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import './styles.css'
import type { Candidate, CandidateStatus, PatrolCard, PatrolCardDetail, RiskLevel } from './types'
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
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-signal">Threads Patrol</p>
            <h1 className="font-display text-2xl font-black tracking-tight md:text-4xl">遇見好車海巡台</h1>
          </div>
          <div className="border-2 border-asphalt px-3 py-2 font-mono text-sm">v{APP_VERSION}</div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[300px_1fr]">
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
          {detail ? <PatrolDetail card={detail} onRefresh={() => loadDetail(detail.id)} onBrowserRun={startBrowserRun} /> : <EmptyState />}
        </section>
      </section>
    </main>
  )
}

function PatrolDetail({ card, onRefresh, onBrowserRun }: { card: PatrolCardDetail; onRefresh: () => void; onBrowserRun: () => void }) {
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
            <p className="mt-2 text-sm">普通酸、自嘲優先。人家認真問，我們就先不要耍嘴皮。</p>
          </div>
          <button onClick={onBrowserRun} className="min-h-11 border-2 border-asphalt px-4 py-2 font-bold transition-colors hover:bg-asphalt hover:text-paper">
            開 Threads 搜尋
          </button>
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
