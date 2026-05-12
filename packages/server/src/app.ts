import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { AppDatabase } from './db.js'
import { registerKeyPoolRoutes } from './key-pool/routes.js'
import { fetchRadarTrends, type RadarTrendResult } from './radar-trends.js'
import { PatrolRepository } from './repository.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
import { assertThreadsSearchAllowed } from './threads-bot/throttle.js'
import { clearThreadsSession, getThreadsSessionStatus, importThreadsStorageState } from './threads-bot/session.js'
import { APP_VERSION } from './version.js'

const createCardSchema = z.object({ keyword: z.string() })
const addCandidateSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  excerpt: z.string().optional()
})
const updateStatusSchema = z.object({ status: z.enum(['useful', 'ignored', 'replied', 'needs_follow_up']) })
const importThreadsSessionSchema = z.object({ storageStateJson: z.string().min(2) })
const RADAR_CACHE_TTL_MS = 10 * 60 * 1000

export function createApp(db: AppDatabase) {
  const app = express()
  const repo = new PatrolRepository(db)
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
  let radarCache: { expiresAt: number; result: RadarTrendResult } | null = null

  app.use(cors({ origin: allowedOrigin }))
  app.use(express.json())

  const apiRouter = express.Router()
  registerKeyPoolRoutes(apiRouter, db)
  app.use('/api', apiRouter)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION })
  })

  const clientDist = resolve('packages/client/dist')
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(resolve(clientDist, 'index.html'))
    })
  }

  app.get('/api/cards', (_req, res) => {
    res.json({ cards: repo.listCards() })
  })

  app.post('/api/cards', (req, res) => {
    try {
      const body = createCardSchema.parse(req.body)
      res.status(201).json({ card: repo.createCard(body.keyword) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/cards/:cardId', (req, res) => {
    const card = repo.getCardDetail(req.params.cardId)
    if (!card) return res.status(404).json({ error: '找不到這張海巡卡。' })
    res.json({ card })
  })

  app.post('/api/cards/:cardId/candidates', (req, res) => {
    try {
      const body = addCandidateSchema.parse(req.body)
      const candidate = repo.addManualCandidate(req.params.cardId, body.url, body.title, body.excerpt)
      res.status(201).json({ candidate })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/cards/:cardId/browser-run', (req, res) => {
    try {
      res.status(202).json({ run: repo.createBrowserRun(req.params.cardId) })
    } catch (error) {
      sendError(res, error)
    }
  })

  async function scanThreads(req: express.Request, res: express.Response) {
    try {
      const cardId = String(req.params.cardId)
      const card = repo.getCardDetail(cardId)
      if (!card) return res.status(404).json({ error: '找不到這張海巡卡。' })
      assertThreadsSearchAllowed(db)
      try {
        const items = await searchThreadsWithPlaywright(db, card.keyword)
        res.status(202).json({ run: repo.createThreadsSearchRun(cardId, items) })
      } catch (playwrightError) {
        const items = await fetchThreadsSearchCandidates(card.keyword)
        const run = repo.createThreadsSearchRun(cardId, items)
        const reason = playwrightError instanceof Error ? playwrightError.message : 'Threads Playwright 搜尋失敗'
        res.status(202).json({ run: { ...run, message: `${run.message}（Playwright 失敗，已改用 site:threads.net 備援：${reason}）` } })
      }
    } catch (error) {
      sendError(res, error)
    }
  }

  app.post('/api/cards/:cardId/scan-threads', scanThreads)
  app.post('/api/cards/:cardId/scan-dcard', (_req, res) => {
    res.status(410).json({ error: 'Dcard 海巡路由已停用。請重新整理頁面後使用 Threads 出勤海巡。' })
  })

  app.get('/api/radar/trends', async (_req, res) => {
    try {
      const now = Date.now()
      if (!radarCache || radarCache.expiresAt <= now) {
        assertThreadsSearchAllowed(db)
        radarCache = { expiresAt: now + RADAR_CACHE_TTL_MS, result: await fetchRadarTrends(db) }
      }
      res.json({ radar: { ...radarCache.result, cachedUntil: new Date(radarCache.expiresAt).toISOString() } })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/session/status', (_req, res) => {
    res.json({ session: getThreadsSessionStatus(db) })
  })

  app.post('/api/threads/session/start', (_req, res) => {
    res.status(202).json({
      loginUrl: 'https://www.threads.net/login',
      message: 'Phase 0 先提供 session 狀態與清除能力；正式互動式登入通道會在下一批接上。'
    })
  })

  app.post('/api/threads/session/clear', (_req, res) => {
    clearThreadsSession(db)
    res.json({ session: getThreadsSessionStatus(db) })
  })

  app.post('/api/threads/session/import', (req, res) => {
    try {
      const body = importThreadsSessionSchema.parse(req.body)
      res.status(201).json({ session: importThreadsStorageState(db, body.storageStateJson) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.patch('/api/candidates/:candidateId/status', (req, res) => {
    try {
      const body = updateStatusSchema.parse(req.body)
      const candidate = repo.updateCandidateStatus(req.params.candidateId, body.status)
      if (!candidate) return res.status(404).json({ error: '找不到這筆結果。' })
      res.json({ candidate })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendError(res, error)
  })

  return app
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof Error) {
    return res.status(400).json({ error: error.message })
  }
  return res.status(400).json({ error: '操作失敗，這很難評，但我們有記下來。' })
}
