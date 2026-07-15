function buildSystemPrompt(skills, categories) {
  const skillsBlock = skills.map(s =>
    JSON.stringify({ name: s.name, description: s.description, params: s.params })
  ).join(',\n')

  const catsBlock = categories && categories.length > 0
    ? `\nДоступные категории: ${categories.join(', ')}`
    : ''

  return `Ты — ядро системы Jenn. Определи намерение пользователя и выбери навык.

Навыки:
[${skillsBlock}]
${catsBlock}
Ответь ТОЛЬКО JSON без пояснений и markdown.
Формат: {"skill": "имя_навыка", "params": { ...поля... }}
Если не подходит ни один навык: {"skill": null, "params": {}}

Для навыка save_entry обязательно укажи params.text с исходным текстом.`
}

function buildCategoryPrompt(userText, categories) {
  const catsBlock = categories && categories.length > 0
    ? categories.map(c => `  - ${c}`).join('\n')
    : '  - (нет категорий, придумай сам)'

  return `Определи категорию для этого текста:

"${userText}"

Доступные категории:
${catsBlock}

Ответь ТОЛЬКО JSON: {"category": "название_категории"}
Если ни одна не подходит, выбери самую близкую или создай новую.`
}

function buildMessages(systemPrompt, userText) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText }
  ]
}

function buildRichPrompt(skills, outputDescriptions, skillsOutputs, defaultOutput) {
  const skillsBlock = skills.map(s =>
    `  ${s.name}\n    ${s.description || ''}\n    Параметры: ${JSON.stringify(Object.keys(s.params || {}))}`
  ).join('\n\n')

  const outputsBlock = Object.entries(outputDescriptions || {}).filter(([, od]) => od).map(([key, od]) => {
    const destsBlock = (od.destinations || []).map(d => {
      const propsBlock = Object.entries(d.properties || {}).map(([name, p]) => {
        let line = `    - "${name}" (тип: ${p.type})`
        if (p.options) line += ` — варианты: [${p.options.join(', ')}]`
        if (p.required) line += ' — обязательно'
        if (!p.required) line += ' — опционально'
        return line
      }).join('\n')
      return `  📁 ${d.name} (${d.id})\n    Поля для заполнения:\n${propsBlock || '    (нет полей)'}`
    }).join('\n\n')
    return `→ ${od.name || key} (${od.id || key})\n${od.description ? `  ${od.description}\n` : ''}\n${destsBlock}`
  }).join('\n\n')

  const routingBlock = Object.entries(skillsOutputs || {}).map(([skill, out]) =>
    `  ${skill} → ${out}`
  ).join('\n') + (defaultOutput ? `\n  default → ${defaultOutput}` : '')

  return `Ты — ядро системы Jenn. Определи намерение пользователя и выбери действие.

ДОСТУПНЫЕ НАВЫКИ:

${skillsBlock}

МЕСТА НАЗНАЧЕНИЯ (OUTPUTS):

${outputsBlock}

МАРШРУТИЗАЦИЯ ПО УМОЛЧАНИЮ:
${routingBlock || '  (не задана)'}

ПРАВИЛА:
- Если пользователь пишет про задачу, поручение, дедлайн, работу — выбери соответствующий навык и destination
- Если про личное, заметку, идею, ссылку — тоже выбери подходящий destination
- Ты можешь переопределить output и destination, вернув поля "output" и "destination" в JSON

ФОРМАТ ОТВЕТА (ТОЛЬКО JSON):
{"skill": "имя_навыка", "params": {...}, "output": "id_output", "destination": "id_destination", "fields": {"Название поля": "значение", ...}}

Где:
- params — параметры для навыка
- fields — заполнение полей destination напрямую (см. "Поля для заполнения" выше)
- Для select выбери значение из списка; для date используй YYYY-MM-DD или "сегодня"/"завтра"
- Если поле опционально — можно не указывать

Если навык не подходит → {"skill": null, "params": {}}

Для навыка save_entry обязательно укажи params.text с текстом пользователя.

ВАЖНО ПРО OUTPUT И DESTINATION:
- output = система (notion, telegram...)
- destination = место внутри (БД "Задачи", чат...)
Правильно: {"output":"notion", "destination":"tasks"}
НЕПРАВИЛЬНО: {"output":"tasks", "destination":"notion"}`
}

module.exports = { buildSystemPrompt, buildCategoryPrompt, buildMessages, buildRichPrompt }
