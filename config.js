require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { prisma } = require('./db')

const defaults = {
  ai: { providers: [] },
  skillsOutputs: {},
  fallbackOutput: null,
  defaultOutput: null,
  outputs: {}
}

// ponytail: write-through cache. Single-process server → cache is coherent.
// Reads are sync (preserves API used in 30+ call sites). Writes hit cache + DB.
const _cache = new Map()
let _cacheReady = false

// Substitute ${VAR} from env into string values (secrets stay in env, not DB)
function substEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || value)
  }
  if (Array.isArray(value)) return value.map(substEnv)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = substEnv(v)
    return out
  }
  return value
}

async function initConfigCache() {
  const rows = await prisma.userConfig.findMany()
  for (const row of rows) {
    _cache.set(row.userId, row.data)
  }
  // also index by username for sync lookup
  const users = await prisma.user.findMany({ select: { id: true, username: true } })
  _userById = new Map(users.map(u => [u.id, u.username]))
  _userIdByUsername = new Map(users.map(u => [u.username, u.id]))
  _cacheReady = true
}

let _userById = new Map()
let _userIdByUsername = new Map()

function loadGlobalConfig() {
  const resolved = path.resolve('jenn.config.json')
  if (!fs.existsSync(resolved)) {
    return { ...defaults }
  }
  const raw = fs.readFileSync(resolved, 'utf-8')
  const config = JSON.parse(raw, (_, value) => {
    if (typeof value === 'string') {
      return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || value)
    }
    return value
  })
  return { ...defaults, ...config }
}

function loadConfig(username) {
  if (!username) return loadGlobalConfig()
  if (!_cacheReady) return { ...defaults }
  const userId = _userIdByUsername.get(username)
  if (!userId) return { ...defaults }
  const raw = _cache.get(userId)
  if (!raw) return { ...defaults }
  return { ...defaults, ...substEnv(raw) }
}

function loadConfigRaw(username) {
  if (!username) return null
  const userId = _userIdByUsername.get(username)
  if (!userId) return null
  return _cache.get(userId) || null
}

function saveConfig(username, configObj) {
  // sync: update cache; async: persist to DB
  let userId = _userIdByUsername.get(username)
  if (userId) {
    _cache.set(userId, configObj)
  }
  // fire-and-forget DB write (create user+config if needed)
  ;(async () => {
    try {
      const u = await prisma.user.findUnique({ where: { username } })
      if (!u) return
      _userIdByUsername.set(username, u.id)
      _cache.set(u.id, configObj)
      await prisma.userConfig.upsert({
        where: { userId: u.id },
        update: { data: configObj },
        create: { userId: u.id, data: configObj },
      })
    } catch (err) {
      console.error(`[Config] saveConfig("${username}") failed:`, err.message)
    }
  })()
}

module.exports = { loadConfig, loadConfigRaw, saveConfig, defaults, initConfigCache }
