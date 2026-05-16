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
        function extractHandle(value: string | null | undefined): string | null {
          if (!value) return null
          const match = value.match(/(?:https:\/\/(?:www\.)?threads\.(?:net|com))?\/@([A-Za-z0-9_.]+)(?:[/?#]|$)/i)
          return match?.[1] ?? null
        }

        function scoreAnchor(anchor: HTMLAnchorElement): number {
          const href = anchor.getAttribute('href') ?? anchor.href
          if (/\/post\//i.test(href)) return 0
          const text = `${anchor.getAttribute('aria-label') ?? ''} ${anchor.getAttribute('title') ?? ''} ${anchor.textContent ?? ''}`.toLowerCase()
          let score = 1
          if (text.includes('profile') || text.includes('個人') || text.includes('個人檔案')) score += 10
          if (anchor.closest('nav,[role="navigation"],[aria-label*="導覽"],[aria-label*="Navigation"]')) score += 4
          if (anchor.querySelector('img')) score += 2
          return score
        }

        const metaHandle = extractHandle(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href)
          ?? extractHandle(document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content)
        if (metaHandle) return metaHandle

        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'))
          .map((anchor) => ({ handle: extractHandle(anchor.getAttribute('href') ?? anchor.href), score: scoreAnchor(anchor) }))
          .filter((item): item is { handle: string; score: number } => Boolean(item.handle) && item.score > 0)
          .sort((a, b) => b.score - a.score)
        if (anchors[0]?.score >= 5) return anchors[0].handle

        const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/json"], script:not([src])'))
        for (const script of scripts) {
          const text = script.textContent ?? ''
          const profileMatch = text.match(/"username"\s*:\s*"([A-Za-z0-9_.]+)"/)
            ?? text.match(/"handle"\s*:\s*"([A-Za-z0-9_.]+)"/)
          if (profileMatch?.[1]) return profileMatch[1]
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
