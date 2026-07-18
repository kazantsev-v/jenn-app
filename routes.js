const store = require('./store')
const { prisma } = require('./db')

async function auth(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token', message: 'Missing or invalid Authorization header' })
  }
  const token = header.slice(7)
  const source = await store.getSourceByToken(token)
  if (!source) {
    return res.status(401).json({ error: 'invalid_token', message: 'Token not found or expired' })
  }
  req.source = source
  req.token = token
  next()
}

function ping(req, res) {
  res.json({ status: 'ok', source: req.source.source })
}

async function postMessage(req, res, processor) {
  const { source, text, user, meta } = req.body

  if (!source || !text || !user?.id) {
    return res.status(400).json({ error: 'missing_fields', message: 'Fields required: source, text, user.id' })
  }

  const tokenSource = req.source?.source
  if (source !== tokenSource) {
    return res.status(403).json({ error: 'source_mismatch', message: `Token belongs to "${tokenSource}", not "${source}"` })
  }

  if (text.length > 4096) {
    return res.status(413).json({ error: 'text_too_long', message: 'Text exceeds 4096 characters' })
  }

  if (!store.checkRateLimit(tokenSource)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again later.' })
  }

  const msg = await store.addMessage(source, text, user, meta, req.source?.username)
  console.log(`[${source}] ${user.name} (${user.id}): "${text}"`)

  const result = await processor.process(msg, req.source?.username)
  await store.setMessageResult(msg.message_id, result)
  console.log(`[Core] → ${JSON.stringify(result)}`)

  res.status(201).json({
    status: 'ok',
    message_id: msg.message_id,
    received_at: msg.received_at,
    result
  })
}

function health(req, res) {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    version: '1.0.0'
  })
}

async function subscribe(req, res) {
  const { email, source } = req.body

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'missing_email', message: 'Email is required' })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'invalid_email', message: 'Invalid email format' })
  }

  try {
    const existing = await prisma.subscriber.findUnique({ where: { email: email.trim().toLowerCase() } })
    if (existing) {
      if (existing.unsubscribedAt) {
        await prisma.subscriber.update({
          where: { email: email.trim().toLowerCase() },
          data: { unsubscribedAt: null, source: source || existing.source }
        })
        return res.status(200).json({ status: 'ok', message: 'Resubscribed successfully' })
      }
      return res.status(409).json({ error: 'already_subscribed', message: 'Email already subscribed' })
    }

    await prisma.subscriber.create({
      data: { email: email.trim().toLowerCase(), source: source || 'landing' }
    })

    res.status(201).json({ status: 'ok', message: 'Subscribed successfully' })
  } catch (err) {
    console.error('[Subscribe] Error:', err.message)
    res.status(500).json({ error: 'internal_error', message: 'Failed to subscribe' })
  }
}

module.exports = { auth, ping, postMessage, health, subscribe }
