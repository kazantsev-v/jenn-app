require('dotenv').config()
const store = require('./store')
const telegramBridge = require('./services/telegram-bridge')
const { disconnect: dbDisconnect } = require('./db')

const JENN_URL = process.env.JENN_URL || 'http://localhost:3000'

async function waitForCore(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${JENN_URL}/health`)
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function start() {
  console.log('[Bot] Waiting for core...')
  const ready = await waitForCore()
  if (!ready) {
    console.error('[Bot] Core not available, exiting')
    process.exit(1)
  }
  console.log('[Bot] Core ready, starting telegram bridge...')
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
