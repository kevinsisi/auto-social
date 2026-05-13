import { chromium, type Browser, type BrowserContext } from 'playwright'
import type { AppDatabase } from '../db.js'
import { loadThreadsStorageState } from './session.js'

let browserPromise: Promise<Browser> | null = null

export function isInsecureTlsEnabled() {
  return process.env.AUTO_SOCIAL_INSECURE_TLS === '1'
}

export async function createThreadsContext(db: AppDatabase): Promise<BrowserContext> {
  const browser = await getBrowser()
  const storageStateJson = safeLoadStorageState(db)
  return browser.newContext({
    storageState: storageStateJson ? JSON.parse(storageStateJson) : undefined,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    ignoreHTTPSErrors: isInsecureTlsEnabled()
  })
}

export async function closeThreadsBrowser() {
  const browser = await browserPromise
  browserPromise = null
  await browser?.close()
}

function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  return browserPromise
}

function safeLoadStorageState(db: AppDatabase) {
  try {
    return loadThreadsStorageState(db)
  } catch {
    return null
  }
}
