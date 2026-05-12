import { createServer } from 'node:http'
import { createApp } from './app.js'
import { browserProxy } from './browser-proxy.js'
import { openDatabase } from './db.js'

const port = Number(process.env.PORT ?? 4323)
const host = process.env.HOST ?? '127.0.0.1'
const app = createApp(openDatabase())
const server = createServer(app)

server.on('upgrade', browserProxy.upgrade)

server.listen(port, host, () => {
  console.log(`auto-social server listening on http://${host}:${port}`)
})
