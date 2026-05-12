import type { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../admin-auth.js'
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
