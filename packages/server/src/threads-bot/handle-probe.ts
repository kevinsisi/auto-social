import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'

const PROBE_TIMEOUT_MS = 15_000

export type HandleProbeResult =
  | { handle: string; source: 'redirect' | 'dom' | 'instagram_api' | 'instagram_user_info' }
  | { handle: null; reason: 'login_redirect' | 'no_anchor_found' | 'probe_failed' }

export async function probeBoundHandle(db: AppDatabase): Promise<HandleProbeResult> {
  let context
  try {
    context = await createThreadsContext(db)
  } catch {
    return { handle: null, reason: 'probe_failed' }
  }
  try {
    const fromInstagram = await probeInstagramCurrentUser(context)
    if (fromInstagram) {
      const handle = `@${fromInstagram}`
      persistHandle(db, handle)
      return { handle, source: 'instagram_api' }
    }

    const fromInstagramUserId = await probeInstagramUserInfo(context)
    if (fromInstagramUserId) {
      const handle = `@${fromInstagramUserId}`
      persistHandle(db, handle)
      return { handle, source: 'instagram_user_info' }
    }

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

async function probeInstagramUserInfo(context: Awaited<ReturnType<typeof createThreadsContext>>): Promise<string | null> {
  const cookies = await context.cookies('https://www.instagram.com')
  const userId = cookies.find((cookie) => cookie.name === 'ds_user_id')?.value
  if (!userId || !/^\d+$/.test(userId)) return null
  const endpoints = [
    `https://i.instagram.com/api/v1/users/${userId}/info/`,
    `https://www.instagram.com/api/v1/users/${userId}/info/`
  ]
  for (const endpoint of endpoints) {
    try {
      const response = await context.request.get(endpoint, {
        timeout: PROBE_TIMEOUT_MS,
        headers: {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest'
        }
      })
      if (!response.ok()) continue
      const username = extractInstagramUsername(await response.text())
      if (username) return username
    } catch {
      // Try the next endpoint.
    }
  }
  return null
}

async function probeInstagramCurrentUser(context: Awaited<ReturnType<typeof createThreadsContext>>): Promise<string | null> {
  const endpoints = [
    'https://www.instagram.com/api/v1/accounts/current_user/?edit=true',
    'https://www.instagram.com/api/v1/accounts/edit/web_form_data/'
  ]
  for (const endpoint of endpoints) {
    try {
      const response = await context.request.get(endpoint, {
        timeout: PROBE_TIMEOUT_MS,
        headers: {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest'
        }
      })
      if (!response.ok()) continue
      const text = await response.text()
      const username = extractInstagramUsername(text)
      if (username) return username
    } catch {
      // Try the next read-only endpoint.
    }
  }
  return null
}

function extractInstagramUsername(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown
    const fromObject = findUsername(parsed)
    if (fromObject) return fromObject
  } catch {
    // Fall through to regex for non-standard JSON responses.
  }
  return text.match(/"username"\s*:\s*"([A-Za-z0-9_.]+)"/)?.[1] ?? null
}

function findUsername(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if ('username' in value && typeof value.username === 'string' && /^[A-Za-z0-9_.]+$/.test(value.username)) return value.username
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findUsername(child)
    if (found) return found
  }
  return null
}

function persistHandle(db: AppDatabase, handle: string | null) {
  db.prepare('UPDATE threads_session SET bound_handle = ? WHERE id = 1').run(handle)
}
