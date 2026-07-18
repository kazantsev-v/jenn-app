const { loadConfig, saveConfig } = require('../config')
const EventEmitter = require('events')

class Processor extends EventEmitter {
  constructor(config) {
    super()
    this.config = config
    this.skills = new Map()
    this.outputs = new Map()
    this.logBuffer = []
    this.MAX_LOG_BUFFER = 500
  }

  getRecentLogs() { return this.logBuffer }

  registerSkill(skill) { this.skills.set(skill.name, skill) }
  getAllSkills() { return [...this.skills.values()] }
  getSkill(name) { return this.skills.get(name) || null }
  getOutput(name) { return this.outputs.get(name) || null }
  registerOutput(name, output) { this.outputs.set(name, output) }

  userConfig(username) {
    if (!username) return this.config
    return loadConfig(username)
  }

  log(type, icon, text, detail) {
    const entry = { time: new Date().toLocaleTimeString('ru'), type, icon, text, detail }
    this.logBuffer.push(entry)
    if (this.logBuffer.length > this.MAX_LOG_BUFFER) this.logBuffer.shift()
    this.emit('log', entry)
  }

  getSkillOutputFunctions(skillName, cfg, instanceConfig = {}) {
    const skillCfg = cfg.skillsConfig?.[skillName] || {}
    const outputName = instanceConfig.output || skillCfg.output
    const output = this.outputs.get(outputName)
    if (!output || !output.functions) return {}
    const outputConfig = cfg?.outputs?.[outputName] || {}
    const fns = {}
    for (const [fname, fn] of Object.entries(output.functions)) {
      fns[fname] = (params) => {
        this.log('output_call', '📞', `${outputName}.${fname}`, JSON.stringify(params))
        return fn.handler(params, outputConfig, {
          output: outputName,
          function: fname,
          skill: skillName,
          legacy: true,
          userConfig: cfg
        })
      }
    }
    return fns
  }

  getAvailableFunctions(cfg) {
    const tools = []
    const configuredOutputs = cfg.outputs || {}

    for (const [outputName, outputConfig] of Object.entries(configuredOutputs)) {
      const output = this.outputs.get(outputName)
      if (!output?.functions) continue

      for (const [functionName, fn] of Object.entries(output.functions)) {
        tools.push({
          id: `${outputName}.${functionName}`,
          output: outputName,
          outputTitle: output.title || outputName,
          function: functionName,
          title: fn.title || functionName,
          description: fn.description || '',
          capability: fn.capability || null,
          params: fn.params || {},
          configured: !!outputConfig
        })
      }
    }

    return tools
  }

  buildFunctionsContext(tools) {
    if (!tools?.length) return '\nДоступные output-функции: (нет настроенных outputs)\n'

    const lines = tools.map(t => {
      const params = Object.entries(t.params || {}).map(([name, def]) => {
        const req = def.required ? 'required' : 'optional'
        return `${name}:${def.type || 'any'}:${req}`
      }).join(', ')
      return `  - ${t.id}${t.capability ? ` [${t.capability}]` : ''}: ${t.description || t.title}${params ? ` (params: ${params})` : ''}`
    })

    return `\nДоступные output-функции Jenn:\n${lines.join('\n')}\n`
  }

  normalizeAction(skill, skillResult, selected, skillCfg) {
    const directCall = selected?.call || selected?.tool || selected?.functionCall
    if (directCall?.output && (directCall.function || directCall.name)) {
      return {
        output: directCall.output,
        function: directCall.function || directCall.name,
        params: { ...(selected.params || {}), ...(directCall.params || {}) },
        source: 'ai_call'
      }
    }

    const action = skillResult?.action || skillResult?.call || null
    if (action) {
      // ponytail: AI router decides output — its choice (selected.output) takes priority over
      // skillConfig.output and the hardcoded action.output from the skill. Service only executes.
      return {
        capability: action.capability || skillResult.capability || skill?.capability || null,
        output: selected?.output || action.output || skillResult.output || skillCfg.output || null,
        function: selected?.function || action.function || action.name || action.tool || skillResult.function || skillCfg.function || skill?.outputFunction || null,
        params: { ...(action.params || skillResult.params || {}), ...(selected?.params && selected.output ? selected.params : {}) },
        source: 'skill_action'
      }
    }

    if (skillResult?.capability) {
      return {
        capability: skillResult.capability,
        output: selected?.output || skillResult.output || skillCfg.output || null,
        function: selected?.function || skillResult.function || skillCfg.function || skill?.outputFunction || null,
        params: skillResult.params || selected?.params || {},
        source: 'skill_capability'
      }
    }

    return null
  }

  resolveOutputFunction(action, cfg, instanceConfig = {}) {
    if (!action) return null
    const tools = this.getAvailableFunctions(cfg)
    const preferredOutput = action.output || null
    const allowedOutputs = instanceConfig.outputs || []

    const candidates = tools.filter(t => {
      if (allowedOutputs.length && !allowedOutputs.includes(t.output)) return false
      if (preferredOutput && t.output !== preferredOutput) return false
      if (action.function && t.function === action.function) return true
      if (action.capability && t.capability === action.capability) return true
      return false
    })

    return candidates[0] || null
  }

  async executeOutputFunction(tool, params, cfg, context = {}) {
    if (!tool) throw new Error('Output function not resolved')

    const output = this.outputs.get(tool.output)
    const fn = output?.functions?.[tool.function]
    if (!fn?.handler) throw new Error(`Output function "${tool.id}" not found`)

    const outputConfig = cfg?.outputs?.[tool.output] || {}
    this.log('output_call', '📞', tool.id, JSON.stringify(params))

    const result = await fn.handler(params || {}, outputConfig, {
      ...context,
      output: tool.output,
      function: tool.function,
      capability: tool.capability,
      userConfig: cfg
    })

    this.log('output_done', '✅', tool.id, JSON.stringify(result))
    return result
  }

  async process(message, username) {
    const cfg = this.userConfig(username)
    this.log('input', '📥', `"${message.text}"`, `от ${message.source}${username ? ` (${username})` : ''}`)

    let skillsList = [...this.skills.values()]
    if (cfg.skills && Array.isArray(cfg.skills) && cfg.skills.length > 0) {
      skillsList = skillsList.filter(s => cfg.skills.includes(s.name))
    }

    if (skillsList.length === 0) {
      this.log('error', '⚠️', 'Нет установленных навыков', 'Установите навык в админке')
      return { skill: null, error: 'No skills installed' }
    }

    const tools = this.getAvailableFunctions(cfg)

    this.log('ai_debug', '🧠', 'Router AI запрос', `навыков: ${skillsList.length}, output-функций: ${tools.length}`)
    const selected = await this.brainPick(skillsList, message.text, cfg)
    if (!selected || (!selected.skill && !selected.call)) {
      this.log('error', '⚠️', 'AI не выбрал навык', selected?.error || 'Unknown')
      return this.fallback(message, cfg)
    }

    if (!selected.skill && selected.call) {
      try {
        const action = this.normalizeAction(null, null, selected, {})
        const tool = this.resolveOutputFunction(action, cfg)
        if (!tool) throw new Error('AI выбрал неизвестную output-функцию')
        const result = await this.executeOutputFunction(tool, action.params, cfg, { message, username, ai: selected })
        return { skill: null, tool: tool.id, result }
      } catch (err) {
        this.log('error', '❌', `Output call: ${err.message}`)
        return { skill: null, error: err.message }
      }
    }

    const skill = this.skills.get(selected.skill)
    if (!skill) {
      this.log('error', '❌', `Навык "${selected.skill}" не найден`)
      return this.fallback(message, cfg)
    }

    const skillCfg = cfg.skillsConfig?.[selected.skill] || {}
    const instanceId = selected.instanceId || 'default'
    const instances = skillCfg.instances || [{ id: 'default', name: 'Default', ...skillCfg }]
    const instanceConfig = instances.find(i => i.id === instanceId) || instances[0] || {}
    
    const outputFunctions = this.getSkillOutputFunctions(selected.skill, cfg, instanceConfig)
    const params = {
      ...(selected.params || {}),
      ...(selected.destination && !(selected.params || {}).destination ? { destination: selected.destination } : {})
    }

    this.log('skill_start', '', `${selected.skill}[${instanceId}]`, `params: ${JSON.stringify(params)}`)

    try {
      const skillResult = await skill.handler(params, message, outputFunctions, instanceConfig)
      this.log('skill_done', '✅', `${selected.skill}[${instanceId}] выполнен`, JSON.stringify(skillResult))

      const action = this.normalizeAction(skill, skillResult, selected, instanceConfig)
      if (!action) return { skill: selected.skill, instanceId, result: skillResult }

      action.params = {
        ...(action.params || {}),
        ...(selected?.fields ? { fields: selected.fields } : {})
      }

      const tool = this.resolveOutputFunction(action, cfg, instanceConfig)
      if (!tool) {
        this.log('error', '❌', `Не найдена output-функция для action`, JSON.stringify(action))
        return { skill: selected.skill, instanceId, action, error: 'Output function not found' }
      }

      const result = await this.executeOutputFunction(tool, action.params, cfg, {
        message,
        username,
        skill: selected.skill,
        instanceId,
        skillResult,
        ai: selected
      })

      return { skill: selected.skill, instanceId, action: { ...action, tool: tool.id }, result }
    } catch (err) {
      this.log('error', '❌', `${selected.skill}[${instanceId}]: ${err.message}`)
      return { skill: selected.skill, instanceId, error: err.message }
    }
  }

  buildSchemaContext(cfg) {
    const parts = []
    const outputs = cfg.outputs || {}
    for (const [oname, ocfg] of Object.entries(outputs)) {
      const destinations = [
        ...(ocfg.destinations || []),
        ...(ocfg.databases || []).filter(db => !(ocfg.destinations || []).find(d =>
          d.type === 'database' && (d.database_id === db.database_id || d.notion_id === db.database_id || d.id === db.id)
        )).map(db => ({ ...db, type: 'database', title: db.title || db.name, notion_id: db.notion_id || db.database_id || db.id }))
      ]
      if (!destinations.length) continue
      const output = this.outputs.get(oname)
      const prefix = output?.title || oname
      const lines = []
      for (const dest of destinations) {
        if (dest.enabled === false) continue
        const userDescription = dest.description ? ` — описание пользователя: ${dest.description}` : ''
        const destId = dest.id || dest.notion_id || dest.name || dest.title
        if (dest.type === 'page') {
          lines.push(`  • ${dest.name || dest.title || dest.id} [page, id: ${destId}]${userDescription} — можно добавлять текст блоками`)
          continue
        }
        const props = dest.properties || {}
        const cols = Object.entries(props).map(([name, prop]) => {
          if (prop.type === 'select' && prop.options) {
            return `${name} [${prop.options.join(', ')}]`
          }
          if (prop.type === 'multi_select') {
            const opts = prop.options || []
            return `${name} [${opts.join(', ')}]`
          }
          return name
        })
        lines.push(`  • ${dest.name || dest.title || dest.id} [database, id: ${destId}]${userDescription} — поля: ${cols.join(', ') || '(schema empty)'}`)
      }
      if (lines.length) parts.push(`${prefix}:\n${lines.join('\n')}`)
    }
    return parts.length ? `\nДоступные destinations:\n${parts.join('\n')}\n` : ''
  }

  async brainPick(skills, userText, cfg) {
    const skillInstances = []
    for (const skill of skills) {
      const skillCfg = cfg.skillsConfig?.[skill.name] || {}
      const instances = skillCfg.instances || [{ id: 'default', name: 'Default', ...skillCfg }]
      for (const instance of instances) {
        skillInstances.push({
          skill: skill.name,
          instanceId: instance.id,
          instanceName: instance.name,
          description: skill.description || '',
          routerInstructions: instance.routerInstructions || '',
          outputs: instance.outputs || [],
          params: skill.params ? Object.keys(skill.params) : []
        })
      }
    }

    const desc = skillInstances.map(si =>
      `  ${si.skill}[${si.instanceId}] "${si.instanceName}": ${si.description}${si.routerInstructions ? ` — ИНСТРУКЦИЯ: ${si.routerInstructions}` : ''}${si.outputs.length ? ` — outputs: [${si.outputs.join(', ')}]` : ''}${si.params.length ? ` (параметры: ${JSON.stringify(si.params)})` : ''}`
    ).join('\n')

    const schemaCtx = this.buildSchemaContext(cfg)
    const toolsCtx = this.buildFunctionsContext(this.getAvailableFunctions(cfg))

    const prompt = `Ты — ядро системы Jenn. Определи намерение пользователя и выбери навык с конкретным инстансом и output.

Доступные навыки и инстансы:
${desc}
${schemaCtx}
${toolsCtx}
Ответь ТОЛЬКО JSON без пояснений и markdown.
Формат: {"skill": "имя_навыка", "instanceId": "id_инстанса", "params": { ...поля... }, "output": "имя_output", "destination": "id_или_название_destination"}

ВАЖНО:
- Каждый навык может иметь несколько инстансов с разными инструкциями
- Выбирай инстанс на основе routerInstructions — они описывают, когда использовать этот инстанс
- Если ни один инстанс не подходит, верни {"skill": null, "params": {}}
- Если точно знаешь нужную output-функцию, можешь добавить:
{"skill": "имя_навыка", "instanceId": "id", "params": {...}, "output": "notion", "call": {"output": "notion", "function": "saveText", "params": {...}}}

Правила заполнения params:
- title — заголовок (кратко, до 8 слов)
- text — полный текст записи
- category — категория (выбери из доступных select/multi_select/status-полей выше)
- destination — выбери id места сохранения из доступных destinations по описанию пользователя
- database — legacy: имя базы данных из списка выше
- date — дата в формате YYYY-MM-DD
- query — поисковый запрос
- ЛЮБОЕ другое поле — используй ТОЧНОЕ имя колонки из schema таблицы (например "Уровень", "Статус", "Автор", "URL", "Email" и т.д.)
- Поддерживаемые типы колонок: select, multi_select, status, date, number, checkbox, url, email, phone_number, rich_text, title, people, files, relation

Важно:
- Ты сам выбираешь output (notion, obsidian и т.д.) на основе текста пользователя И инструкций инстанса
- Если пользователь явно назвал output (например "сохрани в obsidian", "запиши в notion") — ОБЯЗАТЕЛЬНО верни "output": "имя_output"
- Если пользователь назвал место сохранения (папку, БД, destination) — выбери destination по имени
- Инстансы с routerInstructions имеют приоритет при совпадении с инструкцией
- Skills описывают намерение пользователя.
- Output-функции — это реальные инструменты внешних приложений.
- Для сохранения всегда выбирай destination по человеческому описанию: "Хранилище — заметки", "Задачи — четкие задачи", "Кино — фильмы/сериалы" и т.д.
- Если у destination есть select-поля, выбирай category/status из доступных вариантов.
- Если используешь call, output = имя приложения, function = имя функции внутри output.
- Если output не назван пользователем — используй output из инстанса, но верни его явно в "output".`

    this.log('ai_debug', '📤', 'Router AI промпт (полностью)', prompt)

    const aiConfig = (cfg.ai?.providers?.length ? cfg.ai : this.config.ai) || { providers: [] }
    for (const providerCfg of aiConfig.providers || []) {
      const mod = this._loadProvider(providerCfg.name)
      if (!mod) continue
      if (mod.requiresKey && !providerCfg.key) continue
      const instance = mod.create(providerCfg.key)
      try {
        const text = await instance.complete(
          [{ role: 'system', content: prompt }, { role: 'user', content: userText }],
          { model: providerCfg.model || mod.defaultModel }
        )
        this.log('ai_debug', '', 'Router AI ответ (полностью)', text)
        const parsed = this._tryParseJSON(text)
        if (parsed && (typeof parsed.skill === 'string' || parsed.skill === null)) return parsed
        this.log('ai_debug', '⚠️', `${providerCfg.name}: невалидный JSON`, `raw: ${text?.slice(0, 300)}`)
      } catch (err) {
        this.log('ai_debug', '⚠️', `${providerCfg.name}: ${err.message}`)
      }
    }
    return null
  }

  async fallback(message, cfg) {
    const skill = this.skills.get('save_entry')
    if (skill) {
      const skillCfg = cfg.skillsConfig?.save_entry || {}
      const instances = skillCfg.instances || [{ id: 'default', name: 'Default', ...skillCfg }]
      const instanceConfig = instances.find(i => i.fallbackDestination) || instances[0] || {}
      
      const outputFunctions = this.getSkillOutputFunctions('save_entry', cfg, instanceConfig)
      try {
        const skillResult = await skill.handler({ text: message.text, title: message.text.slice(0, 80) }, message, outputFunctions, instanceConfig)
        const action = this.normalizeAction(skill, skillResult, { skill: 'save_entry', params: { text: message.text } }, instanceConfig)
        const tool = this.resolveOutputFunction(action, cfg, instanceConfig)
        if (!tool) return { skill: 'save_entry', fallback: true, result: skillResult }
        const result = await this.executeOutputFunction(tool, action.params, cfg, { message, skill: 'save_entry', fallback: true })
        return { skill: 'save_entry', fallback: true, action: { ...action, tool: tool.id }, result }
      } catch {}
    }
    return { fallback: true }
  }

  _loadProvider(name) {
    try { return require(`../ai/providers/${name}`) } catch { return null }
  }

  _tryParseJSON(text) {
    if (!text) return null
    const start = text.indexOf('{')
    if (start === -1) return null
    let depth = 0, inString = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') depth++
      if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)) } catch { return null } } }
    }
    return null
  }
}

module.exports = Processor
