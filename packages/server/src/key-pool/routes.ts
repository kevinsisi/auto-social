import type { NextFunction, Request, Response, Router } from 'express'
import { z } from 'zod'
import type { AppDatabase } from '../db.js'
import { KeyPoolRepository } from './key-pool.js'
import { syncFromKeyManager } from './key-manager-sync.js'

const batchImportSchema = z.object({ text: z.string() })

export function registerKeyPoolRoutes(router: Router, db: AppDatabase) {
  router.use('/admin/keys', requireAdmin)

  router.get('/admin/keys/status', async (_req, res, next) => {
    try {
      res.json({ keys: await new KeyPoolRepository(db).status() })
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/keys/batch-import', (req, res, next) => {
    try {
      const { text } = batchImportSchema.parse(req.body)
      res.status(201).json(new KeyPoolRepository(db).importKeys(text))
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/keys/sync', async (_req, res, next) => {
    try {
      res.json(await syncFromKeyManager(db))
    } catch (error) {
      next(error)
    }
  })
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ADMIN_TOKEN
  if (token) {
    const header = req.get('authorization') ?? ''
    if (header === `Bearer ${token}`) return next()
    return res.status(401).json({ error: '需要 ADMIN_TOKEN 授權。' })
  }

  if (isLoopback(req.ip ?? '') || isLoopback(req.socket.remoteAddress ?? '')) return next()
  return res.status(403).json({ error: '未設定 ADMIN_TOKEN 時，key 管理 API 僅允許本機存取。' })
}

function isLoopback(value: string) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}
