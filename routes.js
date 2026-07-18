const store = require('./store')

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

module.exports = { auth, ping, postMessage, health }
