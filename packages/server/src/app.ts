import cors from 'cors'
import express from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { getAdminSessionStatus, loginAdmin, logoutAdmin, requireAdmin } from './admin-auth.js'
import { browserProxy } from './browser-proxy.js'
import type { AppDatabase } from './db.js'
import { registerKeyPoolRoutes } from './key-pool/routes.js'
import { scanKeywordCard } from './keyword-scan.js'
import { getKeywordObservation, saveVoiceFeedback } from './observe.js'
import { repipelineCard, repipelineCandidate } from './repipeline.js'
import { DEFAULT_GEMINI_MODEL } from './ai/gemini-client.js'
import { enqueueComposePostDraft, listPostDrafts, regenerateImageForPostDraft } from './post-drafts.js'
import { clearImageGenKey, DEFAULT_IMAGE_MODEL, getImageGenStatus, setImageGenKey } from './image-gen/settings.js'
import { getRadarTrends, scanRadarTrends, schedulePipelineForCandidates, upsertTrendCandidate } from './radar-trends.js'
import { getQueueSnapshot } from './scheduler/task-queue.js'
import { getKeywordSchedulerStatus } from './scheduler/keyword-scheduler.js'
import { PatrolRepository } from './repository.js'
import { getKillSwitch, getThrottleSnapshot, KillSwitchActiveError, resetTodayCount, setDailyLimits, setKillSwitch } from './threads-bot/throttle.js'
import { clearThreadsSession, getThreadsSessionStatus, importThreadsStorageState } from './threads-bot/session.js'
import { probeBoundHandle } from './threads-bot/handle-probe.js'
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
const killSwitchSchema = z.object({ enabled: z.boolean() })
const dailyLimitsSchema = z.object({
  search: z.number().int().min(0).max(100_000).optional(),
  publish: z.number().int().min(0).max(100_000).optional(),
  reply: z.number().int().min(0).max(100_000).optional()
}).refine((limits) => Object.keys(limits).length > 0, { message: '至少要提供一個 quota 欄位。' })
const voiceFeedbackSchema = z.object({
  draftId: z.string().min(1),
  variantIdx: z.number().int().min(0).max(10).default(0),
  decision: z.enum(['like', 'dislike', 'rewrite']),
  comment: z.string().max(2000).optional()
})
const adminLoginSchema = z.object({ token: z.string().min(1) })
const imageGenKeySchema = z.object({
  key: z.string().min(8).max(256),
  model: z.string().min(1).max(120).optional()
})
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

  app.get('/api/about', (_req, res) => {
    const keyManagerHost = (() => {
      const raw = process.env.KEY_MANAGER_URL?.trim()
      if (!raw) return null
      try { return new URL(raw).host } catch { return raw }
    })()
    res.json({
      about: {
        version: APP_VERSION,
        geminiDefaultModel: DEFAULT_GEMINI_MODEL,
        keyManagerHost,
        sessionKeyConfigured: Boolean(process.env.AUTO_SOCIAL_SESSION_KEY?.trim()),
        adminTokenConfigured: Boolean(process.env.ADMIN_TOKEN?.trim()),
        insecureTlsEnabled: process.env.AUTO_SOCIAL_INSECURE_TLS === '1' || process.env.AUTO_SOCIAL_INSECURE_TLS === 'true',
        node: process.version
      }
    })
  })

  app.get('/api/admin/session', (req, res) => {
    res.json({ session: getAdminSessionStatus(req) })
  })

  app.post('/api/admin/session/login', (req, res) => {
    try {
      const body = adminLoginSchema.parse(req.body)
      loginAdmin(req, res, body.token)
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/admin/session/logout', (_req, res) => {
    logoutAdmin(res)
  })

  app.use('/browser', requireAdmin, browserProxy)

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

  app.delete('/api/cards/:cardId', (req, res) => {
    const removed = repo.deleteCard(req.params.cardId)
    if (!removed) return res.status(404).json({ error: '找不到這張海巡卡。' })
    res.status(204).end()
  })

  app.get('/api/keywords/:cardId/observe', (req, res) => {
    const observation = getKeywordObservation(db, String(req.params.cardId))
    if (!observation) return res.status(404).json({ error: '找不到這張海巡卡。' })
    res.json({ observation })
  })

  app.post('/api/keywords/:cardId/repipeline', (req, res) => {
    try {
      const result = repipelineCard(db, String(req.params.cardId))
      res.status(202).json({ repipeline: result })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/keywords/:cardId/candidates/:candidateId/repipeline', (req, res) => {
    try {
      const result = repipelineCandidate(db, String(req.params.cardId), String(req.params.candidateId))
      res.status(result.queued ? 202 : 200).json({ repipeline: result })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/voice/feedback', (req, res) => {
    try {
      const body = voiceFeedbackSchema.parse(req.body)
      const result = saveVoiceFeedback(db, body)
      res.status(201).json({ feedback: result })
    } catch (error) {
      sendError(res, error)
    }
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

  async function scanThreads(req: express.Request, res: express.Response) {
    try {
      const cardId = String(req.params.cardId)
      res.status(202).json({ run: await scanKeywordCard(db, cardId) })
    } catch (error) {
      sendError(res, error)
    }
  }

  app.post('/api/cards/:cardId/scan-threads', scanThreads)

  app.get('/api/cards/:cardId/scan-threads/stream', (req, res) => {
    const cardId = String(req.params.cardId)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    req.socket?.setNoDelay(true)
    res.flushHeaders()
    const send = (payload: object) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      // Force flush past any Node.js internal buffering
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush()
      }
    }
    scanKeywordCard(db, cardId, (progress) => { send({ type: 'progress', ...progress }) })
      .then((run) => { send({ type: 'done', run }); res.end() })
      .catch((err) => { send({ type: 'error', message: err instanceof Error ? err.message : '海巡失敗' }); res.end() })
  })

  app.post('/api/cards/:cardId/scan-dcard', (_req, res) => {
    res.status(410).json({ error: 'Dcard 海巡路由已停用。請重新整理頁面後使用 Threads 出勤海巡。' })
  })

  app.get('/api/ai/status', (_req, res) => {
    res.json({ queue: getQueueSnapshot(db) })
  })

  app.get('/api/scheduler/status', (_req, res) => {
    res.json({ scheduler: getKeywordSchedulerStatus() })
  })

  app.get('/api/post-drafts', (_req, res) => {
    res.json({ drafts: listPostDrafts(db) })
  })

  app.post('/api/admin/post-drafts/run-now', requireAdmin, (_req, res) => {
    try {
      res.status(202).json({ queued: enqueueComposePostDraft(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/admin/post-drafts/:id/regenerate-image', requireAdmin, async (req, res) => {
    try {
      const result = await regenerateImageForPostDraft(db, String(req.params.id))
      res.json({ result })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/post-drafts/:id/image', (req, res) => {
    const row = db.prepare('SELECT image_path FROM post_drafts WHERE id = ?').get(String(req.params.id)) as { image_path: string | null } | undefined
    if (!row?.image_path) return res.status(404).json({ error: '尚無圖片。' })
    const dataDir = process.env.AUTO_SOCIAL_DB ? resolve(process.env.AUTO_SOCIAL_DB, '..') : resolve(process.cwd(), 'data')
    const absolutePath = resolve(dataDir, row.image_path)
    if (!existsSync(absolutePath)) return res.status(404).json({ error: '圖片檔案遺失。' })
    res.sendFile(absolutePath)
  })

  app.get('/api/admin/image-gen/status', requireAdmin, (_req, res) => {
    res.json({ imageGen: getImageGenStatus(db), defaultModel: DEFAULT_IMAGE_MODEL })
  })

  app.put('/api/admin/image-gen/key', requireAdmin, (req, res) => {
    try {
      const body = imageGenKeySchema.parse(req.body)
      setImageGenKey(db, body.key, body.model)
      res.json({ imageGen: getImageGenStatus(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.delete('/api/admin/image-gen/key', requireAdmin, (_req, res) => {
    clearImageGenKey(db)
    res.json({ imageGen: getImageGenStatus(db) })
  })

  app.get('/api/radar/trends', async (_req, res) => {
    try {
      res.json({ radar: getRadarTrends(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/admin/scan/run-now', requireAdmin, async (_req, res) => {
    try {
      if (getKillSwitch(db)) throw new KillSwitchActiveError()
      res.status(202).json({ radar: await scanRadarTrends(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/throttle', (_req, res) => {
    res.json({ throttle: getThrottleSnapshot(db) })
  })

  app.put('/api/admin/threads/daily-limits', requireAdmin, (req, res) => {
    try {
      const body = dailyLimitsSchema.parse(req.body)
      setDailyLimits(db, body)
      res.json({ throttle: getThrottleSnapshot(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/admin/threads/quotas/search/reset-today', requireAdmin, (_req, res) => {
    try {
      const reset = resetTodayCount(db, 'search')
      res.json({ reset, throttle: getThrottleSnapshot(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/kill-switch', (_req, res) => {
    res.json({ enabled: getKillSwitch(db) })
  })

  app.put('/api/threads/kill-switch', requireAdmin, (req, res) => {
    try {
      const body = killSwitchSchema.parse(req.body)
      setKillSwitch(db, body.enabled)
      res.json({ enabled: body.enabled })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/session/status', (_req, res) => {
    res.json({ session: getThreadsSessionStatus(db) })
  })

  app.post('/api/threads/session/start', requireAdmin, async (_req, res) => {
    try {
      res.status(202).json({ login: await startThreadsLoginJob(), message: '已啟動遠端 Chromium 登入。請在嵌入瀏覽器中登入 Instagram/Threads，完成後按「完成並保存」。' })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/threads/session/login/:jobId/status', requireAdmin, (req, res) => {
    const login = getThreadsLoginJobStatus(String(req.params.jobId))
    if (!login) return res.status(404).json({ error: '找不到 Threads 登入工作，請重新開始登入。' })
    res.json({ login })
  })

  app.get('/api/threads/session/login/:jobId/screenshot', requireAdmin, async (req, res) => {
    try {
      const image = await screenshotThreadsLoginJob(String(req.params.jobId))
      res.type('png').send(image)
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/click', requireAdmin, async (req, res) => {
    try {
      const body = clickThreadsLoginSchema.parse(req.body)
      res.json({ login: await clickThreadsLoginJob(String(req.params.jobId), body.x, body.y) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/type', requireAdmin, async (req, res) => {
    try {
      const body = typeThreadsLoginSchema.parse(req.body)
      res.json({ login: await typeThreadsLoginJob(String(req.params.jobId), body.text) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/press', requireAdmin, async (req, res) => {
    try {
      const body = pressThreadsLoginSchema.parse(req.body)
      res.json({ login: await pressThreadsLoginJob(String(req.params.jobId), body.key) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/finish', requireAdmin, async (req, res) => {
    try {
      await finishThreadsLoginJob(db, String(req.params.jobId))
      res.json({ session: getThreadsSessionStatus(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/login/:jobId/cancel', requireAdmin, async (req, res) => {
    try {
      await cancelThreadsLoginJob(String(req.params.jobId))
      res.json({ session: getThreadsSessionStatus(db) })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/clear', requireAdmin, (_req, res) => {
    clearThreadsSession(db)
    res.json({ session: getThreadsSessionStatus(db) })
  })

  app.post('/api/threads/session/import', requireAdmin, (req, res) => {
    try {
      const body = importThreadsSessionSchema.parse(req.body)
      const session = importThreadsStorageState(db, body.storageStateJson)
      schedulePostImportProbe(db)
      res.status(201).json({ session })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/import-from-file', requireAdmin, (req, res) => {
    try {
      const filePath = resolve(process.env.AUTO_SOCIAL_DB ? resolve(process.env.AUTO_SOCIAL_DB, '..') : 'data', 'threads-storage-state.json')
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: `找不到 ${filePath}；請先在電腦執行 npm run threads:login 完成登入。` })
      }
      const storageStateJson = readFileSync(filePath, 'utf8')
      const session = importThreadsStorageState(db, storageStateJson)
      schedulePostImportProbe(db)
      res.status(201).json({ session, importedFrom: filePath })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/threads/session/probe-handle', requireAdmin, async (_req, res) => {
    try {
      const result = await probeBoundHandle(db)
      res.json({ probe: result, session: getThreadsSessionStatus(db) })
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

function schedulePostImportProbe(db: AppDatabase) {
  // Fire-and-forget: try to grab bound handle via Playwright; never block the import response.
  void probeBoundHandle(db).catch(() => undefined)
}
