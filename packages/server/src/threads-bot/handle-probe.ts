import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'

const PROBE_TIMEOUT_MS = 15_000

export type HandleProbeResult =
  | { handle: string; source: 'redirect' | 'dom' }
  | { handle: null; reason: 'login_redirect' | 'no_anchor_found' | 'probe_failed' }

export async function probeBoundHandle(db: AppDatabase): Promise<HandleProbeResult> {
  let context
  try {
    context = await createThreadsContext(db)
  } catch {
    return { handle: null, reason: 'probe_failed' }
  }
  try {
    const page = await context.newPage()
    try {
      await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: PROBE_TIMEOUT_MS })
      await page.waitForTimeout(1_500)

      if (page.url().includes('/login')) {
        return { handle: null, reason: 'login_redirect' }
      }

      const fromDom = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'))
        for (const a of candidates) {
          const ariaLabel = (a.getAttribute('aria-label') ?? '').toLowerCase()
          if (ariaLabel.includes('個人檔案') || ariaLabel.includes('profile') || ariaLabel.includes('個人')) {
            const m = a.getAttribute('href')?.match(/^\/@([A-Za-z0-9_.]+)/)
            if (m && m[1]) return m[1]
          }
        }
        return null
      })

      if (fromDom) {
        const handle = `@${fromDom}`
        persistHandle(db, handle)
        return { handle, source: 'dom' }
      }

      return { handle: null, reason: 'no_anchor_found' }
    } finally {
      await page.close()
    }
  } catch {
    return { handle: null, reason: 'probe_failed' }
  } finally {
    await context.close()
  }
}

function persistHandle(db: AppDatabase, handle: string) {
  db.prepare('UPDATE threads_session SET bound_handle = ? WHERE id = 1').run(handle)
}
