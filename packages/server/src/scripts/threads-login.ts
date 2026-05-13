import { stdout as output } from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const LOGIN_URL = 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.threads.com%2Flogin'
const WORKSPACE_DIR = process.env.INIT_CWD ?? process.cwd()
const OUTPUT_FILE = process.env.THREADS_STORAGE_STATE_OUT
  ? resolve(process.env.THREADS_STORAGE_STATE_OUT)
  : resolve(WORKSPACE_DIR, 'data/threads-storage-state.json')
const PROFILE_DIR = process.env.THREADS_LOGIN_PROFILE_DIR
  ? resolve(process.env.THREADS_LOGIN_PROFILE_DIR)
  : resolve(WORKSPACE_DIR, 'data/threads-login-profile')
const POLL_INTERVAL_MS = 2000
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function main() {
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--start-maximized'],
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: null
  })
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

  output.write('\n已開啟 Instagram/Threads 登入頁。\n')
  output.write('請在瀏覽器完成登入與驗證，直到畫面進入 Threads 首頁或搜尋頁後才會自動保存。\n')
  output.write(`storageState 會寫到：${OUTPUT_FILE}\n\n`)

  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let verified = false
  while (Date.now() < deadline) {
    const cookies = await context.cookies()
    const hasSession = cookies.some((cookie) => cookie.name === 'sessionid' && /(^|\.)(instagram\.com|threads\.(net|com))$/i.test(cookie.domain))
    const currentUrl = page.url()
    const isOnThreads = /^https:\/\/(www\.)?threads\.(net|com)\//i.test(currentUrl) && !currentUrl.includes('/login')
    if (hasSession && isOnThreads) {
      verified = true
      break
    }
    await sleep(POLL_INTERVAL_MS)
  }
  if (!verified) throw new Error('登入逾時：尚未確認進入 Threads 頁面，未保存 session。')

  const storageState = await context.storageState()
  writeFileSync(OUTPUT_FILE, JSON.stringify(storageState, null, 2), 'utf8')
  await context.close()
  output.write(`\n完成：${OUTPUT_FILE}\n把這個 JSON 檔到 Settings -> threads 匯入即可。\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
