require('dotenv').config()
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const express = require('express')

console.log('[DEBUG] SSL_KEY:', process.env.SSL_KEY)
console.log('[DEBUG] SSL_CERT:', process.env.SSL_CERT)
console.log('[DEBUG] DOMAIN:', process.env.DOMAIN)
console.log('[DEBUG] SSL_KEY exists:', process.env.SSL_KEY && fs.existsSync(process.env.SSL_KEY))
console.log('[DEBUG] SSL_CERT exists:', process.env.SSL_CERT && fs.existsSync(process.env.SSL_CERT))
const cookieParser = require('cookie-parser')
const cors = require('cors')
const { loadConfig, initConfigCache } = require('./config')
const Processor = require('./core/processor')
const { auth, ping, postMessage, health } = require('./routes')
const createAdminRouter = require('./routes-admin')
const store = require('./store')
const { disconnect: dbDisconnect } = require('./db')

const processor = new Processor(loadConfig())

const skillsDir = path.join(__dirname, 'skills')
if (fs.existsSync(skillsDir)) {
  for (const f of fs.readdirSync(skillsDir)) {
    if (f.endsWith('.js')) {
      const skill = require(path.join(skillsDir, f))
      processor.registerSkill(skill)
      console.log(`[Skills] Loaded: ${skill.name}`)
    }
  }
}

const outputsDir = path.join(__dirname, 'outputs')
if (fs.existsSync(outputsDir)) {
  for (const f of fs.readdirSync(outputsDir)) {
    if (f.endsWith('.js')) {
      const output = require(path.join(outputsDir, f))
      processor.registerOutput(output.name, output)
      console.log(`[Outputs] Loaded: ${output.name}`)
    }
  }
}

const inputsDir = path.join(__dirname, 'inputs')
const loadedInputs = {}
if (fs.existsSync(inputsDir)) {
  for (const f of fs.readdirSync(inputsDir)) {
    if (f.endsWith('.js')) {
      const input = require(path.join(inputsDir, f))
      loadedInputs[input.name] = input
      console.log(`[Inputs] Loaded: ${input.name}`)
    }
  }
}

const obsidianOut = processor.outputs.get('obsidian')

async function start() {
  await initConfigCache()
  await store.seedTestToken()

  if (obsidianOut?.init) {
    await obsidianOut.init(loadConfig().outputs?.obsidian || {}).catch(err =>
      console.error('[Obsidian] Init error:', err.message))
  }

  const app = express()

  app.use(cookieParser())
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '64kb' }))

  app.use('/v1/admin', createAdminRouter(processor, loadedInputs))

  app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')))
  app.get('/console', (req, res) => res.sendFile(path.join(__dirname, 'public', 'console.html')))
  app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')))
  app.get('/features', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stitch', 'landing-features.html')))
  app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stitch', 'landing-pricing.html')))
  app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq.html')))
  app.get('/faq-article', (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq-article.html')))
  app.get('/products', (req, res) => res.sendFile(path.join(__dirname, 'public', 'products.html')))

  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/v1/ping', auth, ping)
  app.post('/v1/message', auth, (req, res) => postMessage(req, res, processor))
  app.get('/health', health)

  const sslKey = process.env.SSL_KEY
  const sslCert = process.env.SSL_CERT
  const domain = process.env.DOMAIN

  const shutdown = () => {
    obsidianOut?.stop?.()
    dbDisconnect()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  if (sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
    const sslOpts = {
      key: fs.readFileSync(sslKey),
      cert: fs.readFileSync(sslCert),
    }

    https.createServer(sslOpts, app).listen(443, '0.0.0.0', () => {
      console.log(`[Core] HTTPS on https://${domain || 'localhost'}`)
    })

    const redirectApp = express()
    redirectApp.use((req, res) => {
      res.redirect(301, `https://${domain || req.headers.host}${req.url}`)
    })
    http.createServer(redirectApp).listen(80, '0.0.0.0', () => {
      console.log('[Core] HTTP→HTTPS redirect on port 80')
    })
  } else {
    const port = process.env.PORT || 3000
    app.listen(port, '0.0.0.0', () => {
      console.log(`[Core] HTTP on http://localhost:${port}`)
    }).on('error', (err) => {
      console.error('Server error:', err.message)
    })
  }
}

start().catch(err => {
  console.error('Startup failed:', err.message)
  process.exit(1)
})
