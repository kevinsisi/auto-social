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
        persistHandle(db, null)
        return { handle: null, reason: 'login_redirect' }
      }

      const fromDom = await page.evaluate(() => {
        function extractHandle(value: string | null | undefined): string | null {
          if (!value) return null
          const match = value.match(/(?:https:\/\/(?:www\.)?threads\.(?:net|com))?\/@([A-Za-z0-9_.]+)(?:[/?#]|$)/i)
          return match?.[1] ?? null
        }

        const profileAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'))
        for (const anchor of profileAnchors) {
          const href = anchor.getAttribute('href') ?? anchor.href
          if (/\/post\//i.test(href)) continue
          const label = `${anchor.getAttribute('aria-label') ?? ''} ${anchor.getAttribute('title') ?? ''}`.toLowerCase()
          const looksLikeOwnProfile = label.includes('profile') || label.includes('個人') || label.includes('個人檔案')
          if (!looksLikeOwnProfile) continue
          const handle = extractHandle(href)
          if (handle) return handle
        }

        const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/json"], script:not([src])'))
        for (const script of scripts) {
          const text = script.textContent ?? ''
          const profileMatch = text.match(/"viewer"[\s\S]{0,2000}"username"\s*:\s*"([A-Za-z0-9_.]+)"/)
            ?? text.match(/"currentUser"[\s\S]{0,2000}"username"\s*:\s*"([A-Za-z0-9_.]+)"/)
          if (profileMatch?.[1]) return profileMatch[1]
        }

        return null
      })

      if (fromDom) {
        const handle = `@${fromDom}`
        persistHandle(db, handle)
        return { handle, source: 'dom' }
      }

      persistHandle(db, null)
      return { handle: null, reason: 'no_anchor_found' }
    } finally {
      await page.close()
    }
  } catch {
    persistHandle(db, null)
    return { handle: null, reason: 'probe_failed' }
  } finally {
    await context.close()
  }
}

function persistHandle(db: AppDatabase, handle: string | null) {
  db.prepare('UPDATE threads_session SET bound_handle = ? WHERE id = 1').run(handle)
}
