import type { AppDatabase } from '../db.js'

export function assertThreadsSearchAllowed(db: AppDatabase) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('threads.killSwitch') as { value_json: string } | undefined
  if (!row) return
  if (JSON.parse(row.value_json) === true) throw new Error('Threads kill switch 已啟用，暫停 Threads 海巡。')
}
