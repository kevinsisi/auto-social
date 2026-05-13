import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const WORKSPACE_DIR = process.env.INIT_CWD ?? process.cwd()
const OUTPUT_FILE = resolve(WORKSPACE_DIR, 'data/threads-storage-state.json')
const PROFILE_DIR = resolve(WORKSPACE_DIR, 'data/threads-login-profile')

async function main() {
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ignoreHTTPSErrors: process.env.AUTO_SOCIAL_INSECURE_TLS === '1'
  })
  const cookies = await context.cookies()
  const hasIgSession = cookies.some((cookie) => cookie.name === 'sessionid' && /(^|\.)instagram\.com$/i.test(cookie.domain))
  const hasThreadsCookie = cookies.some((cookie) => /threads\.(net|com)$/i.test(cookie.domain))
  const storageState = await context.storageState()
  writeFileSync(OUTPUT_FILE, JSON.stringify(storageState, null, 2), 'utf8')
  await context.close()
  console.log(JSON.stringify({
    outputFile: OUTPUT_FILE,
    cookieCount: cookies.length,
    hasIgSession,
    hasThreadsCookie
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
