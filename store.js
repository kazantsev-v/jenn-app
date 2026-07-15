const { prisma } = require('./db')
const bcrypt = require('bcryptjs')
const { randomUUID } = require('crypto')

// ponytail: rate-limit stays in-memory — ephemeral, per-source window counter
const requestCounts = new Map()

function getSourceByToken(token) {
  if (!token) return null
  return prisma.token.findUnique({
    where: { token },
    select: { source: true, userId: true, user: { select: { username: true } } },
  }).then(t => t ? { source: t.source, username: t.user.username } : null)
}

// Sync variant for routes.js auth (returns null if not found)
async function getSourceByTokenSync(token) {
  if (!token) return null
  const t = await prisma.token.findUnique({
    where: { token },
    select: { source: true, user: { select: { username: true } } },
  })
  return t ? { source: t.source, username: t.user.username } : null
}

async function getUser(username) {
  const u = await prisma.user.findUnique({ where: { username } })
  if (!u) return null
  return { username: u.username, passwordHash: u.passwordHash }
}

async function addUser(username, passwordHash) {
  try {
    await prisma.user.create({ data: { username, passwordHash } })
    return true
  } catch (e) {
    return false
  }
}

async function getUserTokens(username) {
  const u = await prisma.user.findUnique({
    where: { username },
    include: { tokens: true },
  })
  if (!u) return []
  return u.tokens.map(t => ({ source: t.source, token: t.token, createdAt: t.createdAt.toISOString() }))
}

async function getUserToken(username, source) {
  const u = await prisma.user.findUnique({
    where: { username },
    include: { tokens: { where: { source } } },
  })
  if (!u || !u.tokens.length) return null
  return u.tokens[0].token
}

async function createToken(username, source) {
  const u = await prisma.user.findUnique({ where: { username } })
  if (!u) return null
  const token = randomUUID()
  // upsert token for (userId, source) unique
  await prisma.token.upsert({
    where: { userId_source: { userId: u.id, source } },
    update: { token },
    create: { userId: u.id, source, token },
  })
  return token
}

async function deleteToken(username, sourceName) {
  const u = await prisma.user.findUnique({ where: { username } })
  if (!u) return false
  try {
    await prisma.token.delete({ where: { userId_source: { userId: u.id, source: sourceName } } })
    return true
  } catch {
    return false
  }
}

async function addMessage(source, text, user, meta, username) {
  let userId = null
  if (username) {
    const u = await prisma.user.findUnique({ where: { username }, select: { id: true } })
    if (u) userId = u.id
  }
  const msg = await prisma.message.create({
    data: {
      userId,
      source,
      text,
      userMeta: user || null,
      meta: meta || null,
    },
  })
  return {
    message_id: msg.id,
    source: msg.source,
    text: msg.text,
    user: user || {},
    meta: meta || {},
    received_at: msg.receivedAt.toISOString(),
  }
}

async function getMessages({ limit = 50, offset = 0, source } = {}) {
  const where = source ? { source } : {}
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.message.count({ where }),
  ])
  return {
    messages: rows.map(r => ({
      message_id: r.id,
      source: r.source,
      text: r.text,
      user: r.userMeta || {},
      meta: r.meta || {},
      received_at: r.receivedAt.toISOString(),
      result: r.result || undefined,
    })),
    total,
  }
}

async function getMessagesByUser(username, { limit = 50, offset = 0 } = {}) {
  const u = await prisma.user.findUnique({
    where: { username },
    include: { tokens: { select: { source: true } } },
  })
  if (!u || !u.tokens.length) return { messages: [], total: 0 }
  const sources = u.tokens.map(t => t.source)
  const where = { source: { in: sources } }
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.message.count({ where }),
  ])
  return {
    messages: rows.map(r => ({
      message_id: r.id,
      source: r.source,
      text: r.text,
      user: r.userMeta || {},
      meta: r.meta || {},
      received_at: r.receivedAt.toISOString(),
      result: r.result || undefined,
    })),
    total,
  }
}

// ponytail: attach result after processor runs — separate update call
async function setMessageResult(messageId, result) {
  try {
    await prisma.message.update({ where: { id: messageId }, data: { result } })
  } catch {}
}

function checkRateLimit(source) {
  const now = Date.now()
  const window = 60000
  const maxPerWindow = 60
  const key = source || 'unknown'
  if (!requestCounts.has(key)) requestCounts.set(key, [])
  const timestamps = requestCounts.get(key).filter(t => now - t < window)
  timestamps.push(now)
  requestCounts.set(key, timestamps)
  return timestamps.length <= maxPerWindow
}

async function seedTestToken() {
  const count = await prisma.user.count()
  if (count > 0) return
  const hash = bcrypt.hashSync('test', 10)
  const u = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: hash,
      tokens: {
        create: [{ source: 'test_bot', token: 'test-token-550e8400' }],
      },
    },
  })
  console.log('[Store] Seeded admin user + test token')
}

module.exports = {
  getSourceByToken: getSourceByTokenSync,
  getUser,
  addUser,
  getUserTokens,
  getUserToken,
  createToken,
  deleteToken,
  addMessage,
  getMessages,
  getMessagesByUser,
  checkRateLimit,
  seedTestToken,
  setMessageResult,
}
