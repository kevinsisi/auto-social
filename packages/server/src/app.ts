import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { AppDatabase } from './db.js'
import { registerKeyPoolRoutes } from './key-pool/routes.js'
import { getRadarTrends, scanRadarTrends } from './radar-trends.js'
import { PatrolRepository } from './repository.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
import { assertThreadsSearchAllowed } from './threads-bot/throttle.js'
import { clearThreadsSession, getThreadsSessionStatus, importThreadsStorageState } from './threads-bot/session.js'
import { cancelThreadsLoginJob, clickThreadsLoginJob, finishThreadsLoginJob, getThreadsLoginJobStatus, pressThreadsLoginJob, screenshotThreadsLoginJob, startThreadsLoginJob, typeThreadsLoginJob } from './threads-bot/login.js'
import { APP_VERSION } from './version.js'

const createCardSchema = z.object({ keyword: z.string() })
const addCandidateSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  excerpt: z.string().optional()
})
const updateStatusSchema = z.object({ status: z.enum(['useful', 'ignored', 'replied', 'needs_follow_up']) })
const importThreadsSessionSchema = z.object({ storageStateJson: z.string().min(2) })
const clickThreadsLoginSchema = z.object({ x: z.number().min(0), y: z.number().min(0) })
const typeThreadsLoginSchema = z.object({ text: z.string().min(1).max(512) })
const pressThreadsLoginSchema = z.object({ key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace']) })
export function createApp(db: AppDatabase) {
  const app = express()
  const repo = new PatrolRepository(db)
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

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
      res.json({ radar: getRadarTrends(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/admin/scan/run-now', async (_req, res) => {
    try {
      assertThreadsSearchAllowed(db)
      res.status(202).json({ radar: await scanRadarTrends(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/session/status', (_req, res) => {
    res.json({ session: getThreadsSessionStatus(db) })
  })

  app.post('/api/threads/session/start', async (_req, res) => {
    try {
      res.status(202).json({ login: await startThreadsLoginJob(), message: '已啟動 headless Threads 登入。請在截圖上點擊並輸入帳密，登入完成後按「完成並保存」。' })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/session/login/:jobId/status', (req, res) => {
    const login = getThreadsLoginJobStatus(req.params.jobId)
    if (!login) return res.status(404).json({ error: '找不到 Threads 登入工作，請重新開始登入。' })
    res.json({ login })
  })

  app.get('/api/threads/session/login/:jobId/screenshot', async (req, res) => {
    try {
      const image = await screenshotThreadsLoginJob(req.params.jobId)
      res.type('png').send(image)
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/click', async (req, res) => {
    try {
      const body = clickThreadsLoginSchema.parse(req.body)
      res.json({ login: await clickThreadsLoginJob(req.params.jobId, body.x, body.y) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/type', async (req, res) => {
    try {
      const body = typeThreadsLoginSchema.parse(req.body)
      res.json({ login: await typeThreadsLoginJob(req.params.jobId, body.text) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/press', async (req, res) => {
    try {
      const body = pressThreadsLoginSchema.parse(req.body)
      res.json({ login: await pressThreadsLoginJob(req.params.jobId, body.key) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/finish', async (req, res) => {
    try {
      await finishThreadsLoginJob(db, req.params.jobId)
      res.json({ session: getThreadsSessionStatus(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/cancel', async (req, res) => {
    try {
      await cancelThreadsLoginJob(req.params.jobId)
      res.json({ session: getThreadsSessionStatus(db) })
    } catch (error) {
      sendError(res, error)
    }
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
