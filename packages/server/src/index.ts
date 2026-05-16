import { createServer } from 'node:http'
import { createApp } from './app.js'
import { browserProxy } from './browser-proxy.js'
import { openDatabase } from './db.js'
import { composePostTaskHandler } from './post-drafts.js'
import { threadsReplyTaskHandler } from './reply-attempts.js'
import { pipelineTaskHandler } from './scheduler/pipeline-runner.js'
import { startKeywordScheduler } from './scheduler/keyword-scheduler.js'
import { getWorker } from './scheduler/worker.js'

const port = Number(process.env.PORT ?? 4323)
const host = process.env.HOST ?? '127.0.0.1'
const db = openDatabase()
const app = createApp(db)
const server = createServer(app)

server.on('upgrade', browserProxy.upgrade)

const worker = getWorker(db, { pollIntervalMs: 1500 })
worker.register('pipeline', async (workerDb, task) => pipelineTaskHandler(workerDb, task.payload as { candidateId: string }))
worker.register('compose_post', async (workerDb, task) => composePostTaskHandler(workerDb, task.payload as { seedKeyword: string; radarTerms: string[]; posts: Array<{ author: string | null; topic: string | null; excerpt: string }> }))
worker.register('threads_reply', async (workerDb, task) => threadsReplyTaskHandler(workerDb, task.payload as { attemptId: string }))
worker.start()
startKeywordScheduler(db)

server.listen(port, host, () => {
  console.log(`auto-social server listening on http://${host}:${port}`)
  console.log('ai task worker started (polling every 1.5s)')
  console.log('keyword auto scan scheduler started (cron */15 * * * *)')
})
