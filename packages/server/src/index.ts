import { createApp } from './app.js'
import { openDatabase } from './db.js'

const port = Number(process.env.PORT ?? 4323)
const host = process.env.HOST ?? '127.0.0.1'
const app = createApp(openDatabase())

app.listen(port, host, () => {
  console.log(`auto-social server listening on http://${host}:${port}`)
})
