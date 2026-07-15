const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'jenn-dev-secret-change-in-production'

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'jenn-dev-secret-change-in-production') {
  console.error('[Auth] CRITICAL: JWT_SECRET must be set in production!')
  process.exit(1)
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' })
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, JWT_SECRET }
