const { Router } = require('express')
const fs = require('fs')
const path = require('path')
const store = require('./store')
const { loadConfig, loadConfigRaw, saveConfig } = require('./config')
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth')

function createAdminRouter(processor, loadedInputs = {}) {
  const router = Router()

  function authMiddleware(req, res, next) {
    let token = null
    const header = req.headers['authorization']
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7)
    } else if (req.cookies?.jenn_token) {
      token = req.cookies.jenn_token
    }
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
    }
    try {
      const payload = verifyToken(token)
      req.username = payload.username
      next()
    } catch {
      return res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired token' })
    }
  }

  function setTokenCookie(res, token) {
    res.cookie('jenn_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    })
  }

  router.post('/register', async (req, res) => {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_fields', message: 'Username and password required' })
    }
    if (typeof username !== 'string' || username.length < 2 || username.length > 32) {
      return res.status(400).json({ error: 'invalid_username', message: 'Username must be 2-32 characters' })
    }
    if (typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'weak_password', message: 'Password must be at least 4 characters' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'invalid_username', message: 'Username: letters, numbers, underscore only' })
    }
    if (await store.getUser(username)) {
      return res.status(409).json({ error: 'exists', message: 'Username already taken' })
    }
    const hash = await hashPassword(password)
    await store.addUser(username, hash)
    const token = signToken(username)
    setTokenCookie(res, token)
    res.status(201).json({ status: 'ok', token })
  })

  router.post('/login', async (req, res) => {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_fields', message: 'Username and password required' })
    }
    const user = await store.getUser(username)
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' })
    }
    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' })
    }
    const token = signToken(username)
    setTokenCookie(res, token)
    res.json({ status: 'ok', token })
  })

  router.post('/logout', (req, res) => {
    res.clearCookie('jenn_token', { path: '/' })
    res.json({ status: 'ok' })
  })

  router.get('/token', authMiddleware, (req, res) => {
    const token = signToken(req.username)
    setTokenCookie(res, token)
    res.json({ status: 'ok', token })
  })

  router.get('/config', authMiddleware, (req, res) => {
    const config = loadConfigRaw(req.username)
    if (!config) {
      return res.json({ status: 'ok', config: {} })
    }
    res.json({ status: 'ok', config })
  })

  router.put('/config', authMiddleware, (req, res) => {
    const { config } = req.body
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'invalid_body', message: 'Config object required' })
    }
    saveConfig(req.username, config)
    res.json({ status: 'ok' })
  })

  router.get('/sources', authMiddleware, async (req, res) => {
    const tokens = await store.getUserTokens(req.username)
    res.json({ status: 'ok', sources: tokens })
  })

  router.post('/sources', authMiddleware, async (req, res) => {
    const { source } = req.body
    if (!source || typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ error: 'missing_field', message: 'Source name required' })
    }
    const token = await store.createToken(req.username, source.trim())
    if (!token) {
      return res.status(404).json({ error: 'user_not_found', message: 'User not found' })
    }
    res.status(201).json({ status: 'ok', source: source.trim(), token })
  })

  router.delete('/sources/:source', authMiddleware, async (req, res) => {
    const ok = await store.deleteToken(req.username, req.params.source)
    if (!ok) {
      return res.status(404).json({ error: 'not_found', message: 'Source not found' })
    }
    res.json({ status: 'ok' })
  })

  // ── Inputs registry ──

  function getInputsRegistry() {
    return Object.values(loadedInputs)
  }

  function getInputPlugin(name) {
    return loadedInputs[name] || null
  }

  // List installed inputs (from config + store)
  router.get('/inputs', authMiddleware, async (req, res) => {
    const cfg = loadConfigRaw(req.username) || {}
    const installedNames = cfg.inputs || []
    const registry = getInputsRegistry()
    const tokens = await store.getUserTokens(req.username)
    const installed = installedNames.map(name => {
      const meta = registry.find(r => r.name === name) || {}
      const tok = tokens.find(t => t.source === name)
      return { name, title: meta.title || name, description: meta.description || '', icon: meta.icon || '🔌', token: tok?.token || null }
    })
    res.json({ inputs: installed })
  })

  // List all available input types
  router.get('/inputs/library', authMiddleware, (req, res) => {
    res.json({ library: getInputsRegistry() })
  })

  // Install input (add to config + create token)
  router.post('/inputs/:name/install', authMiddleware, async (req, res) => {
    const name = req.params.name
    const plugin = getInputPlugin(name)
    if (!plugin) return res.status(404).json({ error: 'not_found', message: `Input "${name}" not found` })
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.inputs) cfg.inputs = []
    if (!cfg.inputs.includes(name)) cfg.inputs.push(name)
    saveConfig(req.username, cfg)
    await store.createToken(req.username, name)
    res.json({ status: 'ok', message: `Input "${name}" installed` })
  })

  // Uninstall input
  router.delete('/inputs/:name', authMiddleware, async (req, res) => {
    const name = req.params.name
    const cfg = loadConfigRaw(req.username) || {}
    if (cfg.inputs) cfg.inputs = cfg.inputs.filter(s => s !== name)
    saveConfig(req.username, cfg)
    await store.deleteToken(req.username, name)
    res.json({ status: 'ok', message: `Input "${name}" uninstalled` })
  })

  // Get input config (schema + current values + token)
  router.get('/inputs/:name/config', authMiddleware, async (req, res) => {
    const name = req.params.name
    const plugin = getInputPlugin(name)
    if (!plugin) return res.status(404).json({ error: 'not_found', message: `Input "${name}" not found` })
    const cfg = loadConfigRaw(req.username) || {}
    const config = cfg.inputsConfig?.[name] || {}
    const tokens = await store.getUserTokens(req.username)
    const token = tokens.find(t => t.source === name)
    res.json({
      title: plugin.title || name,
      description: plugin.description || '',
      icon: plugin.icon || '📥',
      instructions: plugin.instructions || '',
      configFields: plugin.configFields || [],
      config,
      token: token?.token || null,
      hasTest: typeof plugin.test === 'function'
    })
  })

  // Save input config
  router.put('/inputs/:name/config', authMiddleware, (req, res) => {
    const name = req.params.name
    const plugin = getInputPlugin(name)
    if (!plugin) return res.status(404).json({ error: 'not_found', message: `Input "${name}" not found` })
    const { config } = req.body
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'invalid_config', message: 'Config object required' })
    }
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.inputsConfig) cfg.inputsConfig = {}
    cfg.inputsConfig[name] = config
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Config saved for input "${name}"` })
  })

  // ── Outputs registry ──

  function getOutputsRegistry() {
    const p = path.join(__dirname, 'data', 'outputs-registry.json')
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return [] }
  }

  // List installed outputs (from config + processor)
  router.get('/outputs', authMiddleware, (req, res) => {
    const cfg = loadConfigRaw(req.username) || {}
    const cfgOutputs = cfg.outputs || {}
    const registry = getOutputsRegistry()
    const installed = Object.keys(cfgOutputs).map(name => {
      const meta = registry.find(r => r.name === name) || processor.getOutput(name) || {}
      return { name, title: meta.title || name, description: meta.description || '', icon: meta.icon || '🔌', configured: true }
    })
    res.json({ outputs: installed })
  })

  // List all available output types
  router.get('/outputs/library', authMiddleware, (req, res) => {
    const registry = getOutputsRegistry()
    const enriched = registry.map(entry => {
      const rt = processor.outputs.get(entry.name)
      return {
        ...entry,
        hasTest: typeof rt?.test === 'function',
        authFields: rt?.authFields || [],
        hasDestinations: typeof rt?.listDestinations === 'function',
        canSyncDestinations: typeof rt?.syncDestinations === 'function',
        canCreate: typeof rt?.createDestination === 'function',
        canDescribe: typeof rt?.describeDestination === 'function'
      }
    })
    res.json({ library: enriched })
  })

  // Get output config (with auto-generated fields)
  router.get('/outputs/:name/config', authMiddleware, (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output) return res.status(404).json({ error: 'not_found', message: `Output "${name}" not found` })
    const cfg = loadConfigRaw(req.username) || {}
    const config = cfg.outputs?.[name] || {}
    if (typeof output.getConfig === 'function') {
      const generated = output.getConfig(config)
      const merged = { ...config, ...generated }
      // persist api_key if newly generated
      if (generated.api_key && !config.api_key) {
        const raw = loadConfigRaw(req.username) || {}
        if (!raw.outputs) raw.outputs = {}
        if (!raw.outputs[name]) raw.outputs[name] = {}
        raw.outputs[name].api_key = generated.api_key
        saveConfig(req.username, raw)
      }
      // ensure WS server is running
      if (name === 'obsidian' && typeof output.init === 'function') {
        output.init(merged).catch(err =>
          console.error(`[${name}] init on config open:`, err.message))
      }
      return res.json({ config: merged })
    }
    res.json({ config })
  })

  // Install output (add to config)
  router.post('/outputs/:name/install', authMiddleware, async (req, res) => {
    const name = req.params.name
    const registry = getOutputsRegistry()
    const entry = registry.find(r => r.name === name)
    if (!entry) return res.status(404).json({ error: 'not_found', message: `Output "${name}" not found` })
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.outputs) cfg.outputs = {}
    if (!cfg.outputs[name]) cfg.outputs[name] = {}
    // obsidian: generate per-user API key (token) on install
    if (name === 'obsidian') {
      const key = await store.createToken(req.username, 'obsidian')
      cfg.outputs[name].api_key = key
    }
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Output "${name}" installed` })
  })

  // Uninstall output
  router.delete('/outputs/:name', authMiddleware, async (req, res) => {
    const name = req.params.name
    const cfg = loadConfigRaw(req.username) || {}
    if (cfg.outputs && cfg.outputs[name]) delete cfg.outputs[name]
    if (name === 'obsidian') await store.deleteToken(req.username, 'obsidian')
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Output "${name}" uninstalled` })
  })

  router.get('/messages', authMiddleware, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const result = await store.getMessagesByUser(req.username, { limit, offset })
    res.json({ status: 'ok', ...result })
  })

  router.post('/test-message', authMiddleware, async (req, res) => {
    const { text } = req.body
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'missing_field', message: 'Text required' })
    }
    const msg = await store.addMessage('admin_panel', text, { id: req.username, name: req.username }, {}, req.username)
    const result = await processor.process(msg, req.username)
    await store.setMessageResult(msg.message_id, result)
    res.status(201).json({ status: 'ok', message_id: msg.message_id, result })
  })

  router.post('/inputs/:name/test', authMiddleware, async (req, res) => {
    const name = req.params.name
    const plugin = getInputPlugin(name)
    if (!plugin) return res.status(404).json({ error: 'not_found', message: `Input "${name}" not found` })
    const config = req.body.config || loadConfigRaw(req.username)?.inputsConfig?.[name] || {}
    if (typeof plugin.test === 'function') {
      try {
        const result = await plugin.test(config)
        res.json({ status: 'ok', ...result })
      } catch (err) {
        res.status(400).json({ error: 'test_failed', message: err.message || 'Test failed' })
      }
    } else {
      res.json({ status: 'ok', message: `Input "${name}" is ready` })
    }
  })

  router.post('/outputs/:name/test', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output) {
      return res.status(404).json({ error: 'not_found', message: `Output "${name}" not loaded` })
    }
    const config = req.body.config || (req.body.api_key ? { api_key: req.body.api_key } : (loadConfigRaw(req.username)?.outputs?.[name] || {}))
    if (typeof output.test === 'function') {
      try {
        const result = await output.test(config, req.username)
        res.json({ status: 'ok', ...result })
      } catch (err) {
        res.status(400).json({ error: 'test_failed', message: err.message || 'Test failed' })
      }
    } else {
      res.json({ status: 'ok', message: `Output "${name}" is registered and ready` })
    }
  })

  // Generic output lifecycle endpoints

  function outputConfig(req, name) {
    return req.body.config || (req.body.api_key ? { api_key: req.body.api_key } : (loadConfigRaw(req.username)?.outputs?.[name] || {}))
  }

  // List available destinations for an output
  router.post('/outputs/:name/destinations', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output || typeof output.listDestinations !== 'function') {
      return res.status(400).json({ error: 'not_supported', message: `Output "${name}" does not support destination listing` })
    }
    try {
      const result = await output.listDestinations(outputConfig(req, name), req.username)
      res.json(result)
    } catch (err) {
      res.status(400).json({ error: 'list_failed', message: err.message })
    }
  })

  // Sync output destinations from the external app into user config
  router.post('/outputs/:name/sync-destinations', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output || typeof output.syncDestinations !== 'function') {
      return res.status(400).json({ error: 'not_supported', message: `Output "${name}" does not support destination sync` })
    }
    try {
      const result = await output.syncDestinations(outputConfig(req, name), req.username)
      const cfg = loadConfigRaw(req.username) || {}
      if (!cfg.outputs) cfg.outputs = {}
      if (!cfg.outputs[name]) cfg.outputs[name] = {}
      if (result.config) cfg.outputs[name] = { ...cfg.outputs[name], ...result.config }
      if (result.destinations) cfg.outputs[name].destinations = result.destinations
      if (result.databases) cfg.outputs[name].databases = result.databases
      saveConfig(req.username, cfg)
      res.json({ status: 'ok', ...result })
    } catch (err) {
      res.status(400).json({ error: 'sync_failed', message: err.message })
    }
  })

  // Create a new destination
  router.post('/outputs/:name/create-destination', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output || typeof output.createDestination !== 'function') {
      return res.status(400).json({ error: 'not_supported', message: `Output "${name}" does not support creating destinations` })
    }
    try {
      const result = await output.createDestination(outputConfig(req, name), req.body.params || {})
      if (result.destinations) {
        const cfg = loadConfigRaw(req.username) || {}
        if (!cfg.outputs) cfg.outputs = {}
        if (!cfg.outputs[name]) cfg.outputs[name] = {}
        cfg.outputs[name] = { ...cfg.outputs[name], ...result.config }
        if (result.destinations) cfg.outputs[name].destinations = result.destinations || cfg.outputs[name].destinations
        saveConfig(req.username, cfg)
      }
      res.json(result)
    } catch (err) {
      res.status(400).json({ error: 'create_failed', message: err.message })
    }
  })

  // Describe a destination (get schema / property mapping)
  router.post('/outputs/:name/describe', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output || typeof output.describeDestination !== 'function') {
      return res.status(400).json({ error: 'not_supported', message: `Output "${name}" does not support describing destinations` })
    }
    try {
      const result = await output.describeDestination(outputConfig(req, name), req.body.destination_id || req.body.id, req.username)
      res.json(result)
    } catch (err) {
      res.status(400).json({ error: 'describe_failed', message: err.message })
    }
  })

  router.get('/logs/stream', (req, res) => {
    let token = req.query.token
    if (!token && req.cookies?.jenn_token) token = req.cookies.jenn_token
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    try {
      verifyToken(token)
    } catch {
      return res.status(401).json({ error: 'invalid_token' })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const onLog = (entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`)
    }

    processor.on('log', onLog)

    req.on('close', () => {
      processor.off('log', onLog)
    })
  })

  router.get('/logs/recent', authMiddleware, (req, res) => {
    res.json({ logs: processor.getRecentLogs() })
  })

  // ── Skills endpoints ──

  function describeSkill(skill) {
    if (typeof skill.describe === 'function') return skill.describe()
    return { name: skill.name, description: skill.description || '', author: 'Jenn Core', version: '1.0.0', params: skill.params || {} }
  }

  function userSkillNames(username) {
    const cfg = loadConfigRaw(username)
    if (cfg && cfg.skills && Array.isArray(cfg.skills) && cfg.skills.length > 0) return cfg.skills
    return processor.getAllSkills().map(s => s.name)
  }

  function getSkillsDir() {
    return path.join(__dirname, 'skills')
  }

  // List user's installed skills
  router.get('/skills', authMiddleware, (req, res) => {
    const allowedNames = userSkillNames(req.username)
    const allSkills = processor.getAllSkills()
    const installed = allSkills.filter(s => allowedNames.includes(s.name))
    res.json({ skills: installed.map(describeSkill) })
  })

  // Get local registry
  function getSkillsRegistry() {
    const registryPath = path.join(__dirname, 'data', 'skills-registry.json')
    try { return JSON.parse(fs.readFileSync(registryPath, 'utf-8')) } catch { return [] }
  }

  function saveSkillsRegistry(registry) {
    const registryPath = path.join(__dirname, 'data', 'skills-registry.json')
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8')
  }

  // Library: built-in registry + marketplace
  router.get('/skills/library', authMiddleware, async (req, res) => {
    const allSkills = processor.getAllSkills()
    const local = allSkills.map(describeSkill)
    let remote = []
    let registryOnline = false
    const registryUrl = process.env.SKILLS_REGISTRY || 'https://registry.jenn.ai/v1/skills'
    try {
      const transport = registryUrl.startsWith('https') ? require('https') : require('http')
      const body = await new Promise((resolve, reject) => {
        const r = transport.get(registryUrl, { timeout: 5000 }, resp => {
          let d = ''
          resp.on('data', c => d += c)
          resp.on('end', () => resolve(d))
        })
        r.on('error', reject)
      })
      remote = JSON.parse(body)
      if (!Array.isArray(remote)) remote = []
      registryOnline = true
      // Update local registry cache
      const cached = getSkillsRegistry()
      for (const r of remote) {
        const idx = cached.findIndex(c => c.name === r.name)
        if (idx !== -1) cached[idx] = { ...r, local: true }
        else cached.push({ ...r, local: true })
      }
      saveSkillsRegistry(cached)
    } catch (e) {
      console.log(`[Skills] Marketplace unreachable: ${e.message}`)
    }
    // If marketplace offline, use local registry cache
    if (!registryOnline) {
      const cached = getSkillsRegistry()
      remote = cached.filter(c => !local.find(l => l.name === c.name))
    }
    // Merge: local overrides remote
    const localNames = new Set(local.map(s => s.name))
    const merged = [...local, ...remote.filter(r => !localNames.has(r.name))]
    res.json({ library: merged, local: local.length, remote: remote.length, registryOnline })
  })

  // Install skill (add to user config, download from marketplace if needed)
  router.post('/skills/:name/install', authMiddleware, async (req, res) => {
    const name = req.params.name
    const allSkills = processor.getAllSkills()
    let skill = allSkills.find(s => s.name === name)

    // Not registered locally — try downloading from marketplace
    if (!skill) {
      const registry = getSkillsRegistry()
      const entry = registry.find(r => r.name === name)
      if (!entry) return res.status(404).json({ error: 'not_found', message: `Skill "${name}" not found anywhere` })
      if (entry.download_url) {
        try {
          const transport = entry.download_url.startsWith('https') ? require('https') : require('http')
          const code = await new Promise((resolve, reject) => {
            const r = transport.get(entry.download_url, { timeout: 10000 }, resp => {
              let d = ''
              resp.on('data', c => d += c)
              resp.on('end', () => resolve(d))
            })
            r.on('error', reject)
          })
          const skillPath = path.join(getSkillsDir(), `${name}.js`)
          fs.writeFileSync(skillPath, code, 'utf-8')
          delete require.cache[require.resolve(skillPath)]
          skill = require(skillPath)
          processor.registerSkill(skill)
        } catch (e) {
          return res.status(502).json({ error: 'download_failed', message: e.message })
        }
      } else {
        return res.status(404).json({ error: 'no_download', message: 'No download URL for this skill' })
      }
    }

    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.skills) cfg.skills = processor.getAllSkills().map(s => s.name)
    if (cfg.skills.includes(name)) return res.json({ status: 'ok', message: 'Already installed' })
    cfg.skills.push(name)
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Skill "${name}" installed` })
  })

  // Uninstall skill (remove from user config)
  router.delete('/skills/:name', authMiddleware, (req, res) => {
    const name = req.params.name
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.skills) cfg.skills = processor.getAllSkills().map(s => s.name)
    cfg.skills = cfg.skills.filter(s => s !== name)
    // Also remove from skillsOutputs
    if (cfg.skillsOutputs && cfg.skillsOutputs[name]) delete cfg.skillsOutputs[name]
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Skill "${name}" uninstalled` })
  })

  // Create custom skill
  router.post('/skills/create', authMiddleware, async (req, res) => {
    const { name, description, params, code } = req.body
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return res.status(400).json({ error: 'invalid_name', message: 'Invalid skill name' })
    }
    if (!code) return res.status(400).json({ error: 'no_code', message: 'Skill code required' })
    const skillPath = path.join(getSkillsDir(), `${name}.js`)
    if (fs.existsSync(skillPath) && !req.body.overwrite) {
      return res.status(409).json({ error: 'exists', message: 'Skill already exists' })
    }
    const wrappedCode = `module.exports = ${JSON.stringify({ name, description: description || '', params: params || {}, handler: null })}`
    // For security, we write a wrapper. In production, use sandboxed evaluation.
    fs.writeFileSync(skillPath, `// Custom skill: ${name}\n// Author: ${req.username}\n\n${code}`, 'utf-8')
    delete require.cache[require.resolve(skillPath)]
    const skill = require(skillPath)
    processor.registerSkill(skill)
    // Auto-install for creator
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.skills) cfg.skills = processor.getAllSkills().map(s => s.name)
    if (!cfg.skills.includes(name)) cfg.skills.push(name)
    saveConfig(req.username, cfg)
    res.status(201).json({ status: 'ok', message: `Skill "${name}" created and installed` })
  })

  // Publish to marketplace
  router.post('/skills/:name/publish', authMiddleware, async (req, res) => {
    const name = req.params.name
    const allSkills = processor.getAllSkills()
    const skill = allSkills.find(s => s.name === name)
    if (!skill) return res.status(404).json({ error: 'not_found', message: `Skill "${name}" not found` })
    const meta = describeSkill(skill)
    const registryUrl = process.env.SKILLS_REGISTRY || 'https://registry.jenn.ai/v1/skills'
    const skillPath = path.join(getSkillsDir(), `${name}.js`)
    const code = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : ''
    try {
      const transport = registryUrl.startsWith('https') ? require('https') : require('http')
      const postData = JSON.stringify({ ...meta, code, author: req.username, action: 'publish' })
      const result = await new Promise((resolve, reject) => {
        const r = transport.request(registryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }, timeout: 10000 }, resp => {
          let d = ''
          resp.on('data', c => d += c)
          resp.on('end', () => resolve(d))
        })
        r.on('error', reject)
        r.write(postData)
        r.end()
      })
      res.json({ status: 'ok', registry: result.slice(0, 200) })
    } catch (e) {
      res.status(502).json({ error: 'registry_error', message: e.message })
    }
  })

  // Get skill config schema + user's current config
  router.get('/skills/:name/config', authMiddleware, (req, res) => {
    const name = req.params.name
    const allSkills = processor.getAllSkills()
    const skill = allSkills.find(s => s.name === name)
    if (!skill) return res.status(404).json({ error: 'not_found', message: `Skill "${name}" not found` })
    const meta = describeSkill(skill)
    const cfg = loadConfigRaw(req.username) || {}
    const userConfig = cfg.skillsConfig?.[name] || {}
    const outputs = [...processor.outputs.keys()]
    const outputFunctions = {}
    const outputFunctionDetails = {}
    const outputDestinations = {}
    for (const [oname, output] of processor.outputs) {
      outputFunctions[oname] = output.functions ? Object.keys(output.functions) : []
      outputFunctionDetails[oname] = Object.entries(output.functions || {}).map(([key, fn]) => ({
        name: key,
        title: fn.title || key,
        capability: fn.capability || null,
        description: fn.description || '',
        params: fn.params || {}
      }))
      const ocfg = cfg.outputs?.[oname] || {}
      outputDestinations[oname] = [
        ...(ocfg.destinations || []),
        ...(ocfg.databases || []).filter(db => !(ocfg.destinations || []).find(d => d.type === 'database' && (d.notion_id === db.database_id || d.database_id === db.database_id))).map(db => ({
          ...db,
          type: 'database',
          title: db.title || db.name,
          notion_id: db.notion_id || db.database_id || db.id
        }))
      ]
    }
    res.json({
      schema: meta.configSchema || {},
      config: userConfig,
      outputs,
      outputFunctions,
      outputFunctionDetails,
      outputDestinations,
      capability: meta.capability || skill.capability || null,
      skillOutputFunction: skill.outputFunction || null
    })
  })

  // Aggregate installed skills as user-facing capabilities
  router.get('/capabilities', authMiddleware, (req, res) => {
    const allowedNames = userSkillNames(req.username)
    const allSkills = processor.getAllSkills()
    const installed = allSkills.filter(s => allowedNames.includes(s.name))
    res.json({
      capabilities: installed.map(s => ({
        name: s.name,
        title: s.title || s.name,
        icon: s.icon || '⚡',
        description: s.description || '',
        capability: s.capability || null,
        outputFunction: s.outputFunction || null,
        params: s.params || {}
      }))
    })
  })

  // List functions exposed by an output
  router.get('/outputs/:name/functions', authMiddleware, (req, res) => {
    const name = req.params.name
    const output = processor.getOutput(name)
    if (!output) return res.status(404).json({ error: 'not_found', message: `Output "${name}" not found` })
    const fns = output.functions || {}
    const list = Object.entries(fns).map(([key, fn]) => ({
      name: key,
      title: fn.title || key,
      capability: fn.capability || null,
      description: fn.description,
      params: fn.params || {}
    }))
    res.json({ functions: list })
  })

  // Sync database schema from Notion (live properties → config)
  router.post('/outputs/:name/sync-schema', authMiddleware, async (req, res) => {
    const name = req.params.name
    const output = processor.outputs.get(name)
    if (!output || !output.functions?.syncSchema) {
      return res.status(400).json({ error: 'not_supported', message: `Output "${name}" does not support schema sync` })
    }
    try {
      const config = outputConfig(req, name)
      const result = await output.functions.syncSchema.handler({}, config)
      const cfg = loadConfigRaw(req.username) || {}
      if (!cfg.outputs) cfg.outputs = {}
      if (!cfg.outputs[name]) cfg.outputs[name] = {}
      if (result.databases) {
        cfg.outputs[name].databases = result.databases
        saveConfig(req.username, cfg)
      }
      res.json({ status: 'ok', databases: result.databases })
    } catch (err) {
      res.status(400).json({ error: 'sync_failed', message: err.message })
    }
  })

  // Save skill config
  router.post('/skills/:name/config', authMiddleware, (req, res) => {
    const name = req.params.name
    const { config } = req.body
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'invalid_config', message: 'Config object required' })
    }
    const cfg = loadConfigRaw(req.username) || {}
    if (!cfg.skillsConfig) cfg.skillsConfig = {}
    cfg.skillsConfig[name] = config
    saveConfig(req.username, cfg)
    res.json({ status: 'ok', message: `Config saved for skill "${name}"` })
  })

  return router
}

module.exports = createAdminRouter
