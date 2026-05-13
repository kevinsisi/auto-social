import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { nanoid } from 'nanoid'
import type { AppDatabase } from '../db.js'
import { saveThreadsStorageState } from './session.js'

export type ThreadsLoginJobStatus = {
  id: string
  url: string
  vncUrl: string
  createdAt: string
  lastActivityAt: string
}

type LoginJob = ThreadsLoginJobStatus & {
  browser: Browser
  context: BrowserContext
  page: Page
}

const LOGIN_URL = 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.threads.com%2Flogin'
const LOGIN_JOB_TTL_MS = 15 * 60 * 1000
const VIEWPORT = { width: 1280, height: 800 }
const DISPLAY = ':99'
const VNC_URL = '/browser/vnc.html?autoconnect=true&resize=scale&path=browser/websockify'

const jobs = new Map<string, LoginJob>()
let remoteBrowserProcesses: ChildProcess[] = []
let remoteBrowserServicesStarted = false

export async function startThreadsLoginJob(): Promise<ThreadsLoginJobStatus> {
  cleanupExpiredLoginJobs()
  const existing = [...jobs.values()][0]
  if (existing) return toStatus(existing)

  await startRemoteBrowserServices()
  const browser = await chromium.launch({
    headless: false,
    env: { ...process.env, DISPLAY },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  })
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: VIEWPORT,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
  })
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const timestamp = new Date().toISOString()
  const job: LoginJob = { id: nanoid(), browser, context, page, url: page.url(), vncUrl: VNC_URL, createdAt: timestamp, lastActivityAt: timestamp }
  jobs.set(job.id, job)
  return toStatus(job)
}

export function getThreadsLoginJobStatus(jobId: string): ThreadsLoginJobStatus | null {
  cleanupExpiredLoginJobs()
  const job = jobs.get(jobId)
  if (!job) return null
  return toStatus(job)
}

export async function screenshotThreadsLoginJob(jobId: string) {
  const job = requireJob(jobId)
  job.lastActivityAt = new Date().toISOString()
  job.url = job.page.url()
  return job.page.screenshot({ type: 'png', fullPage: false })
}

export async function clickThreadsLoginJob(jobId: string, x: number, y: number) {
  const job = requireJob(jobId)
  await job.page.mouse.click(x, y)
  await settle(job.page)
  touch(job)
  return toStatus(job)
}

export async function typeThreadsLoginJob(jobId: string, text: string) {
  const job = requireJob(jobId)
  await job.page.keyboard.type(text, { delay: 25 })
  await settle(job.page)
  touch(job)
  return toStatus(job)
}

export async function pressThreadsLoginJob(jobId: string, key: string) {
  const job = requireJob(jobId)
  await job.page.keyboard.press(key)
  await settle(job.page)
  touch(job)
  return toStatus(job)
}

export async function finishThreadsLoginJob(db: AppDatabase, jobId: string) {
  const job = requireJob(jobId)
  const storageState = await job.context.storageState()
  saveThreadsStorageState(db, JSON.stringify(storageState), null)
  await closeJob(job)
  jobs.delete(jobId)
}

export async function cancelThreadsLoginJob(jobId: string) {
  const job = jobs.get(jobId)
  if (!job) return
  await closeJob(job)
  jobs.delete(jobId)
}

function requireJob(jobId: string) {
  cleanupExpiredLoginJobs()
  const job = jobs.get(jobId)
  if (!job) throw new Error('找不到 Threads 登入工作，請重新開始登入。')
  return job
}

function cleanupExpiredLoginJobs() {
  const now = Date.now()
  for (const job of jobs.values()) {
    if (now - Date.parse(job.lastActivityAt) > LOGIN_JOB_TTL_MS) {
      void closeJob(job)
      jobs.delete(job.id)
    }
  }
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
}

function touch(job: LoginJob) {
  job.url = job.page.url()
  job.lastActivityAt = new Date().toISOString()
}

async function closeJob(job: LoginJob) {
  await job.context.close().catch(() => undefined)
  await job.browser.close().catch(() => undefined)
}

function toStatus(job: LoginJob): ThreadsLoginJobStatus {
  return { id: job.id, url: job.url, vncUrl: job.vncUrl, createdAt: job.createdAt, lastActivityAt: job.lastActivityAt }
}

async function startRemoteBrowserServices() {
  if (remoteBrowserServicesStarted) return
  remoteBrowserServicesStarted = true
  remoteBrowserProcesses = [
    spawnService('Xvfb', [DISPLAY, '-screen', '0', `${VIEWPORT.width}x${VIEWPORT.height}x24`, '-ac']),
    spawnService('fluxbox', [], { DISPLAY }),
    spawnService('x11vnc', ['-display', DISPLAY, '-forever', '-shared', '-nopw', '-rfbport', '5900']),
    spawnService('websockify', ['--web', '/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900'])
  ]
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}

function spawnService(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, { stdio: 'ignore', env: { ...process.env, ...env } })
  child.on('exit', () => {
    remoteBrowserServicesStarted = false
  })
  return child
}
