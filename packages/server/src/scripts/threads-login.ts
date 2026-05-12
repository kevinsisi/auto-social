import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const LOGIN_URL = 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.threads.net%2Flogin'
const OUTPUT_FILE = resolve(process.env.THREADS_STORAGE_STATE_OUT ?? 'data/threads-storage-state.json')

async function main() {
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: null
  })
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

  output.write('\n已開啟 Instagram/Threads 登入頁。\n')
  output.write('請在瀏覽器完成登入，看到 Threads 頁面後回到這個終端機按 Enter。\n')
  output.write(`storageState 會寫到：${OUTPUT_FILE}\n\n`)

  const rl = createInterface({ input, output })
  await rl.question('登入完成後按 Enter 保存 session... ')
  rl.close()

  const storageState = await context.storageState()
  writeFileSync(OUTPUT_FILE, JSON.stringify(storageState, null, 2), 'utf8')
  await browser.close()
  output.write(`\n完成：${OUTPUT_FILE}\n把這個 JSON 檔到 Settings -> threads 匯入即可。\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
