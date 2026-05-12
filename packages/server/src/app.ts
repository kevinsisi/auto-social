import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { AppDatabase } from './db.js'
import { PatrolRepository } from './repository.js'
import { APP_VERSION } from './version.js'

const createCardSchema = z.object({ keyword: z.string() })
const addCandidateSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  excerpt: z.string().optional()
})
const updateStatusSchema = z.object({ status: z.enum(['useful', 'ignored', 'replied', 'needs_follow_up']) })

export function createApp(db: AppDatabase) {
  const app = express()
  const repo = new PatrolRepository(db)
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

  app.use(cors({ origin: allowedOrigin }))
  app.use(express.json())

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

  return app
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof Error) {
    return res.status(400).json({ error: error.message })
  }
  return res.status(400).json({ error: '操作失敗，這很難評，但我們有記下來。' })
}
