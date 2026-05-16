import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Locator, Page } from 'playwright'
import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'
import { markThreadsSessionUnhealthy } from './session.js'
import { gate, type GateOptions } from './throttle.js'

export type ThreadsReplyInput = {
  attemptId: string
  targetUrl: string
  replyText: string
  boundHandle: string
}

export type ThreadsReplyAutomationResult = {
  status: 'succeeded' | 'failed' | 'uncertain'
  verificationMethod?: 'reply_url' | 'dom_match'
  replyUrl?: string | null
  error?: string | null
  screenshotPath?: string | null
}

export type ThreadsReplyAutomationDeps = {
  gate?: (db: AppDatabase, op: 'reply', options?: GateOptions) => Promise<void>
  createContext?: typeof createThreadsContext
  markSessionUnhealthy?: typeof markThreadsSessionUnhealthy
}

const REPLY_TIMEOUT_MS = 45_000
const SCREENSHOT_DIR = 'threads-reply-screenshots'

export async function performThreadsReply(db: AppDatabase, input: ThreadsReplyInput, deps: ThreadsReplyAutomationDeps = {}): Promise<ThreadsReplyAutomationResult> {
  const gateFn = deps.gate ?? gate
  const createContext = deps.createContext ?? createThreadsContext
  const markSessionUnhealthy = deps.markSessionUnhealthy ?? markThreadsSessionUnhealthy
  await gateFn(db, 'reply')
  const context = await createContext(db)
  const page = await context.newPage()
  let submitted = false
  try {
    await page.goto(input.targetUrl, { waitUntil: 'domcontentloaded', timeout: REPLY_TIMEOUT_MS })
    await page.waitForTimeout(1_500)

    if (page.url().includes('/login')) {
      markSessionUnhealthy(db, 'Threads 要求重新登入。')
      return { status: 'failed', error: 'Threads session 已失效或尚未登入。' }
    }

    const clickedReply = await clickFirstVisible(page, [
      'div[role="button"][aria-label*="回覆"]',
      'div[role="button"][aria-label*="留言"]',
      'div[role="button"][aria-label*="Reply"]',
      'button[aria-label*="Reply"]',
      '[role="button"]:has-text("回覆")',
      '[role="button"]:has-text("Reply")'
    ])
    if (!clickedReply) {
      return { status: 'failed', error: '找不到 Threads 回覆按鈕。', screenshotPath: await saveScreenshot(page, input.attemptId) }
    }

    const textbox = await firstVisibleLocator(page, [
      '[contenteditable="true"][role="textbox"]',
      '[role="textbox"][contenteditable="true"]',
      'textarea',
      '[contenteditable="true"]'
    ])
    if (!textbox) {
      return { status: 'failed', error: '找不到 Threads 留言輸入框。', screenshotPath: await saveScreenshot(page, input.attemptId) }
    }
    await textbox.fill(input.replyText)
    await page.waitForTimeout(500)

    const clickedSubmit = await clickFirstVisible(page, [
      'div[role="button"]:has-text("發布")',
      'div[role="button"]:has-text("回覆")',
      'div[role="button"]:has-text("Reply")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("發布")',
      'button:has-text("Reply")',
      'button:has-text("Post")'
    ])
    if (!clickedSubmit) {
      return { status: 'failed', error: '找不到 Threads 送出留言按鈕。', screenshotPath: await saveScreenshot(page, input.attemptId) }
    }
    submitted = true

    await page.waitForTimeout(3_000)
    const verification = await verifyReplyOnPage(page, input)
    if (verification.replyUrl) {
      return { status: 'succeeded', verificationMethod: 'reply_url', replyUrl: verification.replyUrl }
    }
    if (verification.domMatch) {
      return { status: 'succeeded', verificationMethod: 'dom_match', replyUrl: null }
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: REPLY_TIMEOUT_MS }).catch(() => undefined)
    await page.waitForTimeout(2_000)
    const afterReload = await verifyReplyOnPage(page, input)
    if (afterReload.replyUrl) {
      return { status: 'succeeded', verificationMethod: 'reply_url', replyUrl: afterReload.replyUrl }
    }
    if (afterReload.domMatch) {
      return { status: 'succeeded', verificationMethod: 'dom_match', replyUrl: null }
    }

    return {
      status: 'uncertain',
      error: '留言可能已送出，但無法在頁面上驗證。請手動確認 Threads。',
      screenshotPath: await saveScreenshot(page, input.attemptId)
    }
  } catch (error) {
    return {
      status: submitted ? 'uncertain' : 'failed',
      error: error instanceof Error ? error.message : String(error),
      screenshotPath: await saveScreenshot(page, input.attemptId)
    }
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function firstVisibleLocator(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const loc = page.locator(selector).last()
    try {
      if (await loc.count() > 0 && await loc.isVisible({ timeout: 1_000 })) return loc
    } catch {
      // Try the next selector; Threads changes labels frequently.
    }
  }
  return null
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  const loc = await firstVisibleLocator(page, selectors)
  if (!loc) return false
  await loc.click({ timeout: 5_000 })
  return true
}

async function verifyReplyOnPage(page: Page, input: ThreadsReplyInput): Promise<{ replyUrl: string | null; domMatch: boolean }> {
  return page.evaluate(({ replyText, boundHandle }) => {
    const normalizedHandle = boundHandle.replace(/^@/, '').toLowerCase()
    function hasReplyText(text: string) { return text.replace(/\s+/g, ' ').includes(replyText.replace(/\s+/g, ' ')) }
    function hasHandle(text: string) { return text.toLowerCase().includes(normalizedHandle) }

    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'))) {
      let node: Element | null = link
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const text = node.textContent ?? ''
        if (hasReplyText(text) && hasHandle(text)) return { replyUrl: new URL(link.href, location.href).href, domMatch: true }
      }
    }
    const bodyText = document.body?.textContent ?? ''
    return { replyUrl: null, domMatch: hasReplyText(bodyText) && hasHandle(bodyText) }
  }, input)
}

async function saveScreenshot(page: Page, attemptId: string): Promise<string | null> {
  try {
    const dataDir = process.env.AUTO_SOCIAL_DB ? resolve(process.env.AUTO_SOCIAL_DB, '..') : resolve(process.cwd(), 'data')
    const dir = resolve(dataDir, SCREENSHOT_DIR)
    mkdirSync(dir, { recursive: true })
    const relativePath = `${SCREENSHOT_DIR}/${attemptId}.png`
    await page.screenshot({ path: resolve(dataDir, relativePath), fullPage: true })
    return relativePath
  } catch {
    return null
  }
}
