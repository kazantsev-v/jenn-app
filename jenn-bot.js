require('dotenv').config()
const store = require('./store')
const telegramBridge = require('./services/telegram-bridge')
const { disconnect: dbDisconnect } = require('./db')

const JENN_URL = process.env.JENN_URL || 'http://localhost:3000'

async function start() {
  console.log(`[Bot] JENN_URL=${JENN_URL}`)
  await store.seedTestToken()
  await telegramBridge.start(store)
  console.log('[Bot] Telegram bridge started')
}

const shutdown = () => {
  telegramBridge.stop()
  dbDisconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start().catch(err => {
  console.error('[Bot] Startup failed:', err.message)
  process.exit(1)
})
