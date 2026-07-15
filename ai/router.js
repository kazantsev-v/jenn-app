const { buildSystemPrompt, buildCategoryPrompt, buildMessages, buildRichPrompt } = require('./prompt')

class AIRouter {
  constructor(config) {
    this.providers = []

    for (const p of config.providers || []) {
      const mod = loadProvider(p.name)
      if (!mod) {
        console.warn(`[AI] Unknown provider: ${p.name}`)
        continue
      }
      if (mod.requiresKey && !p.key) {
        console.warn(`[AI] No key for ${p.name}, skipping`)
        continue
      }
      const instance = mod.create(p.key)
      this.providers.push({
        name: p.name,
        model: p.model || mod.defaultModel,
        instance
      })
    }

    if (this.providers.length === 0) {
      console.warn('[AI] No AI providers configured — all messages will go to fallback')
    }
  }

  async determineIntent(skills, userText, outputDescriptions, cfg) {
    const useRich = outputDescriptions && cfg
    const systemPrompt = useRich
      ? buildRichPrompt(skills, outputDescriptions, cfg.skillsOutputs, cfg.defaultOutput)
      : buildSystemPrompt(skills, outputDescriptions || [])
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }]
    let lastError = null

    for (const provider of this.providers) {
      try {
        const text = await provider.instance.complete(messages, { model: provider.model })
        console.log(`[AI] ${provider.name} raw:`, text)
        const parsed = tryParseJSON(text)
        if (parsed && (typeof parsed.skill === 'string' || parsed.skill === null)) {
          return { ...parsed, _raw: text, _prompt: systemPrompt }
        }
        console.warn(`[AI] ${provider.name}: invalid response format, trying next`)
        lastError = new Error('Invalid response format')
      } catch (err) {
        console.warn(`[AI] ${provider.name}: ${err.message}`)
        lastError = err
      }
    }

    console.warn('[AI] All providers failed')
    return { skill: null, params: {}, error: lastError?.message || 'No providers available' }
  }

  async determineCategory(userText, categories) {
    if (!categories || categories.length === 0) return { category: null }
    const prompt = buildCategoryPrompt(userText, categories)
    const messages = [{ role: 'user', content: prompt }]
    let lastError = null

    for (const provider of this.providers) {
      try {
        const text = await provider.instance.complete(messages, { model: provider.model })
        console.log(`[Category AI] ${provider.name}:`, text)
        const parsed = tryParseJSON(text)
        if (parsed && typeof parsed.category === 'string') {
          return { ...parsed, _raw: text, _prompt: prompt }
        }
        lastError = new Error('Invalid category format')
      } catch (err) {
        console.warn(`[Category AI] ${provider.name}: ${err.message}`)
        lastError = err
      }
    }
    return { category: null, error: lastError?.message || 'Category AI failed' }
  }
}

function tryParseJSON(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function loadProvider(name) {
  try {
    return require(`./providers/${name}`)
  } catch {
    return null
  }
}

module.exports = AIRouter
