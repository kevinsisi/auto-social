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

  router.post('/admin/keys/reset-cooldowns', (_req, res, next) => {
    try {
      const result = db.prepare('UPDATE api_keys SET cooldown_until = 0, lease_until = 0, lease_token = NULL WHERE is_active = 1').run()
      res.json({ reset: result.changes })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/admin/keys/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'id 必須是正整數。' })
      }
      const removed = new KeyPoolRepository(db).deleteKey(id)
      if (!removed) return res.status(404).json({ error: `找不到 id=${id} 的 key。` })
      res.json({ deleted: id })
    } catch (error) {
      next(error)
    }
  })
}
