import { createServer } from 'node:http'
import { createApp } from './app.js'
import { browserProxy } from './browser-proxy.js'
import { openDatabase } from './db.js'
import { pipelineTaskHandler } from './scheduler/pipeline-runner.js'
import { getWorker } from './scheduler/worker.js'

const port = Number(process.env.PORT ?? 4323)
const host = process.env.HOST ?? '127.0.0.1'
const db = openDatabase()
const app = createApp(db)
const server = createServer(app)

server.on('upgrade', browserProxy.upgrade)

const worker = getWorker(db, { pollIntervalMs: 1500 })
worker.register('pipeline', async (workerDb, task) => pipelineTaskHandler(workerDb, task.payload as { candidateId: string }))
worker.start()

server.listen(port, host, () => {
  console.log(`auto-social server listening on http://${host}:${port}`)
  console.log('ai task worker started (polling every 1.5s)')
})
