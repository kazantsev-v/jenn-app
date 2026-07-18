const { Client } = require('@notionhq/client')

function makeNotionClient(apiKey) {
  return new Client({ auth: apiKey, notionVersion: '2022-06-28' })
}

function resolveDateString(str) {
  if (!str || typeof str !== 'string') return null
  let s = str.trim().toLowerCase()
  const prepPattern = /^(в |во |к |до |на |с |после |перед |к следующ(?:ей|ему) |в следующ(?:ую|ем) )/
  s = s.replace(prepPattern, '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d = 86400000
  const rel = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }
  if (rel[s] !== undefined) return new Date(today.getTime() + rel[s] * d).toISOString().slice(0, 10)
  const wd = { 'воскресенье': 0, 'понедельник': 1, 'вторник': 2, 'среда': 3, 'четверг': 4, 'пятница': 5, 'суббота': 6 }
  if (wd[s] !== undefined) {
    let diff = wd[s] - today.getDay()
    if (diff <= 0) diff += 7
    return new Date(today.getTime() + diff * d).toISOString().slice(0, 10)
  }
  return null
}

const NAME_MAP = [
  { key: 'title',    types: ['title'],                          names: ['название', 'заголовок', 'title', 'name'] },
  { key: 'text',     types: ['rich_text'],                      names: ['текст', 'содержание', 'описание', 'text', 'content', 'message'] },
  { key: 'content',  types: ['rich_text'],                      names: ['текст', 'содержание', 'text', 'content', 'message'] },
  { key: 'category', types: ['select', 'multi_select', 'status'], names: ['категория', 'тип', 'category', 'type'] },
  { key: 'date',     types: ['date'],                           names: ['дата', 'срок', 'date', 'deadline'] },
  { key: 'source',   types: ['select', 'multi_select', 'status'], names: ['источник', 'source'] },
  { key: 'priority', types: ['select', 'multi_select', 'status'], names: ['приоритет', 'priority'] },
  { key: 'tags',     types: ['multi_select'],                    names: ['теги', 'tags', 'labels'] },
  { key: 'status',   types: ['select', 'multi_select', 'status'], names: ['статус', 'status'] },
  { key: 'url',      types: ['url'],                             names: ['ссылка', 'url', 'link', 'website', 'сайт'] },
  { key: 'email',    types: ['email'],                           names: ['почта', 'email', 'e-mail'] },
  { key: 'phone',    types: ['phone_number'],                    names: ['телефон', 'phone', 'tel'] },
  { key: 'number',   types: ['number'],                          names: ['число', 'number', 'count', 'amount', 'количество', 'сумма'] },
  { key: 'checked',  types: ['checkbox'],                        names: ['галочка', 'checkbox', 'done', 'выполнено', 'check'] },
]

function smartMapToProperties(data, liveProps) {
  const props = {}
  const used = new Set()

  function findCol(types, names) {
    for (const [name, def] of Object.entries(liveProps)) {
      if (used.has(name)) continue
      if (!types.includes(def.type)) continue
      if (names.includes(name.toLowerCase().trim())) return name
    }
    for (const [name, def] of Object.entries(liveProps)) {
      if (used.has(name)) continue
      if (types.includes(def.type)) return name
    }
    return null
  }

  function build(name, def, val) {
    if (val === undefined || val === null || val === '') return null
    if (def.type === 'title') return { title: [{ type: 'text', text: { content: String(val).slice(0, 2000) } }] }
    if (def.type === 'rich_text') return { rich_text: [{ type: 'text', text: { content: String(val).slice(0, 2000) } }] }
    if (def.type === 'select') return { select: { name: String(val) } }
    if (def.type === 'status') return { status: { name: String(val) } }
    if (def.type === 'date') {
      const iso = resolveDateString(String(val))
      return iso ? { date: { start: iso } } : null
    }
    if (def.type === 'multi_select') {
      const items = Array.isArray(val) ? val : String(val).split(',').map(s => s.trim())
      return { multi_select: items.map(t => ({ name: t })) }
    }
    if (def.type === 'number') {
      const n = Number(val)
      return isNaN(n) ? null : { number: n }
    }
    if (def.type === 'checkbox') return { checkbox: Boolean(val) }
    if (def.type === 'url') return { url: String(val).slice(0, 2000) }
    if (def.type === 'email') return { email: String(val).slice(0, 2000) }
    if (def.type === 'phone_number') return { phone_number: String(val).slice(0, 2000) }
    if (def.type === 'people') {
      const people = Array.isArray(val) ? val : [val]
      return { people: people.map(p => typeof p === 'string' ? { id: p } : p) }
    }
    if (def.type === 'files') {
      const files = Array.isArray(val) ? val : [val]
      return { files: files.map(f => typeof f === 'string' ? { name: f, external: { url: f } } : f) }
    }
    if (def.type === 'relation') {
      const ids = Array.isArray(val) ? val : [val]
      return { relation: ids.map(id => ({ id: String(id) })) }
    }
    return null
  }

  for (const rule of NAME_MAP) {
    const val = data[rule.key]
    if (val === undefined || val === null || val === '') continue
    const col = findCol(rule.types, rule.names)
    if (!col) continue
    const built = build(col, liveProps[col], val)
    if (built) { props[col] = built; used.add(col) }
  }

  const SKIP_KEYS = new Set(['title', 'text', 'content', 'destination', 'database'])

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined || val === null || val === '') continue
    if (SKIP_KEYS.has(key)) continue
    for (const [colName, colDef] of Object.entries(liveProps)) {
      if (used.has(colName)) continue
      if (colName.toLowerCase().trim() === key.toLowerCase().trim()) {
        const built = build(colName, colDef, val)
        if (built) { props[colName] = built; used.add(colName) }
      }
    }
  }

  const TYPE_HINT = {
    date: ['date'],
    tags: ['multi_select'],
    priority: ['select', 'multi_select', 'status'],
    category: ['select', 'multi_select', 'status'],
    source: ['select', 'multi_select', 'status'],
    status: ['select', 'multi_select', 'status'],
    url: ['url'],
    email: ['email'],
    phone: ['phone_number'],
    number: ['number'],
    checked: ['checkbox'],
  }

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined || val === null || val === '') continue
    if (SKIP_KEYS.has(key)) continue
    if (Object.values(props).some(p => {
      const v = p.select?.name || p.status?.name || p.rich_text?.[0]?.text?.content || p.date?.start || p.url || p.email || p.phone_number
      return v === String(val)
    })) continue
    const hints = TYPE_HINT[key] || ['select', 'rich_text', 'multi_select', 'number', 'checkbox', 'url']
    const col = findCol(hints, [])
    if (col) {
      const built = build(col, liveProps[col], val)
      if (built) { props[col] = built; used.add(col) }
    }
  }

  return props
}

function notionPropertySchema(def) {
  if (!def?.type) return null
  if (def.type === 'title') return { title: {} }
  if (def.type === 'rich_text') return { rich_text: {} }
  if (def.type === 'date') return { date: {} }
  if (def.type === 'number') return { number: {} }
  if (def.type === 'checkbox') return { checkbox: {} }
  if (def.type === 'url') return { url: {} }
  if (def.type === 'email') return { email: {} }
  if (def.type === 'phone_number') return { phone_number: {} }
  if (def.type === 'select') {
    return {
      select: {
        options: (def.options || []).map(name => ({ name: String(name) }))
      }
    }
  }
  if (def.type === 'multi_select') {
    return {
      multi_select: {
        options: (def.options || []).map(name => ({ name: String(name) }))
      }
    }
  }
  if (def.type === 'status') {
    return {
      status: {
        options: (def.options || []).map(name => ({ name: String(name) }))
      }
    }
  }
  if (def.type === 'people') return { people: {} }
  if (def.type === 'files') return { files: {} }
  if (def.type === 'relation') {
    return { relation: { database_id: def.database_id || '' } }
  }
  return null
}

async function ensureConfiguredProperties(notion, db, liveProps, data, log) {
  const desired = { ...(db.properties || {}) }
  Object.assign(desired, inferDesiredProperties(data, desired, liveProps))
  const missing = {}

  for (const [name, def] of Object.entries(desired)) {
    if (liveProps[name]) continue
    if (def.type === 'title') {
      const hasTitle = Object.values(liveProps).some(p => p.type === 'title')
      if (hasTitle) continue
    }
    const schema = notionPropertySchema(def)
    if (!schema || def.type === 'title') continue
    missing[name] = schema
  }

  if (!Object.keys(missing).length) return liveProps

  try {
    log?.(`creating missing properties: ${Object.keys(missing).join(', ')}`)
    await notion.databases.update({
      database_id: db.database_id,
      properties: missing
    })
    const refreshed = await notion.databases.retrieve({ database_id: db.database_id })
    return refreshed.properties || liveProps
  } catch (err) {
    log?.(`property auto-create skipped: ${err.message}`)
    return liveProps
  }
}

function inferDesiredProperties(data, desired, liveProps) {
  const inferred = {}
  const liveNames = new Set(Object.keys(liveProps || {}).map(n => n.toLowerCase().trim()))
  const desiredNames = new Set(Object.keys(desired || {}).map(n => n.toLowerCase().trim()))
  const hasType = (type) => Object.values(liveProps || {}).some(p => p.type === type) || Object.values(desired || {}).some(p => p.type === type)
  const hasName = (name) => liveNames.has(name.toLowerCase()) || desiredNames.has(name.toLowerCase())
  const hasSelectType = () => hasType('select') || hasType('multi_select') || hasType('status')

  if ((data.text || data.content) && !hasType('rich_text') && !hasName('Текст')) {
    inferred['Текст'] = { type: 'rich_text' }
  }
  if (data.category && !hasSelectType() && !hasName('Категория')) {
    inferred['Категория'] = { type: 'select', options: [String(data.category)] }
  }
  if (data.date && !hasType('date') && !hasName('Дата')) {
    inferred['Дата'] = { type: 'date' }
  }
  if (data.source && !hasSelectType() && !hasName('Источник')) {
    inferred['Источник'] = { type: 'select', options: [String(data.source)] }
  }
  if (data.priority && !hasSelectType() && !hasName('Приоритет')) {
    inferred['Приоритет'] = { type: 'select', options: ['low', 'medium', 'high', String(data.priority)].filter((v, i, a) => a.indexOf(v) === i) }
  }
  if (data.tags && !hasType('multi_select') && !hasName('Теги')) {
    inferred['Теги'] = { type: 'multi_select', options: Array.isArray(data.tags) ? data.tags.map(String) : [] }
  }
  return inferred
}

function textChunks(text, size = 1900) {
  const chunks = []
  const s = String(text || '')
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size))
  return chunks
}

function buildPageChildren(data, mappedProperties) {
  const children = []
  const hasRichTextProperty = Object.values(mappedProperties || {}).some(p => p.rich_text)

  if (!hasRichTextProperty && data.text) {
    for (const chunk of textChunks(data.text)) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      })
    }
  }

  return children
}

function titleFromRichText(items, fallback) {
  const text = (items || []).map(t => t.plain_text || t.text?.content || '').join('').trim()
  return text || fallback
}

function titleFromPage(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === 'title') return titleFromRichText(prop.title, page.id.slice(0, 8))
  }
  return page.id.slice(0, 8)
}

function normalizeDatabaseDestination(db) {
  return {
    id: db.id || db.name || db.database_id,
    type: 'database',
    name: db.name || db.title || db.id || db.database_id,
    title: db.title || db.name || db.id || db.database_id,
    description: db.description || '',
    enabled: db.enabled !== false,
    notion_id: db.notion_id || db.database_id || db.id,
    database_id: db.database_id || db.notion_id || db.id,
    url: db.url || null,
    properties: db.properties || {},
    categories: db.categories || []
  }
}

function schemaFromNotionProperties(props) {
  const properties = {}
  for (const [name, def] of Object.entries(props || {})) {
    properties[name] = { type: def.type }
    if (def.type === 'select' && def.select?.options) {
      properties[name].options = def.select.options.map(o => o.name)
    }
    if (def.type === 'multi_select' && def.multi_select?.options) {
      properties[name].options = def.multi_select.options.map(o => o.name)
    }
    if (def.type === 'status' && def.status?.options) {
      properties[name].options = def.status.options.map(o => o.name)
    }
  }
  return properties
}

async function enrichDatabaseDestination(notion, destination) {
  try {
    const live = await notion.databases.retrieve({ database_id: destination.database_id || destination.notion_id })
    return {
      ...destination,
      name: titleFromRichText(live.title, destination.name),
      title: titleFromRichText(live.title, destination.title),
      url: live.url || destination.url,
      properties: schemaFromNotionProperties(live.properties || {})
    }
  } catch {
    return destination
  }
}

function normalizePageDestination(page) {
  return {
    id: page.id || page.name || page.page_id || page.notion_id,
    type: 'page',
    name: page.name || page.title || page.id || page.page_id || page.notion_id,
    title: page.title || page.name || page.id || page.page_id || page.notion_id,
    description: page.description || '',
    enabled: page.enabled !== false,
    notion_id: page.notion_id || page.page_id || page.id,
    page_id: page.page_id || page.notion_id || page.id,
    url: page.url || null
  }
}

function configuredDestinations(config) {
  const destinations = []
  for (const d of config?.destinations || []) {
    if (d.type === 'page') destinations.push(normalizePageDestination(d))
    else destinations.push(normalizeDatabaseDestination(d))
  }
  for (const db of config?.databases || []) {
    const normalized = normalizeDatabaseDestination(db)
    if (!destinations.find(d => d.id === normalized.id || d.notion_id === normalized.notion_id)) {
      destinations.push(normalized)
    }
  }
  return destinations
}

function pickDestination(config, name, preferredType) {
  const destinations = configuredDestinations(config)
  const enabled = destinations.filter(d => d.enabled !== false)
  const pool = preferredType ? enabled.filter(d => d.type === preferredType) : enabled
  if (!name) return pool[0] || null
  const lower = String(name).toLowerCase().trim()
  const exactId = pool.find(d =>
    d.id?.toLowerCase?.().trim() === lower ||
    d.notion_id?.toLowerCase?.().trim() === lower
  )
  if (exactId) return exactId

  const nameMatches = pool.filter(d =>
    d.name?.toLowerCase?.().trim() === lower ||
    d.title?.toLowerCase?.().trim() === lower
  )
  if (nameMatches.length > 1 && !preferredType) {
    return nameMatches.find(d => d.type === 'database') || nameMatches[0]
  }
  return nameMatches[0] || pool[0] || null
}

async function writeToDatabase(db, data, apiKey, log) {
  const notion = makeNotionClient(apiKey)

  let liveSchema
  try {
    liveSchema = await notion.databases.retrieve({ database_id: db.database_id })
  } catch (err) {
    return { error: `database.retrieve failed: ${err.message}` }
  }
  let liveProps = liveSchema.properties || {}

  log?.(`schema: ${liveSchema.title?.[0]?.plain_text || '?'} — ${Object.keys(liveProps).length} props: ${Object.keys(liveProps).join(', ')}`)

  if (Object.keys(liveProps).length === 0) {
    return { error: 'Database has no accessible properties' }
  }

  liveProps = await ensureConfiguredProperties(notion, db, liveProps, data, log)

  log?.(`liveProps after ensure: ${JSON.stringify(Object.entries(liveProps).map(([n, d]) => `${n}:${d.type}`))}`)
  log?.(`data keys: ${Object.keys(data).join(', ')}`)
  log?.(`data.category: ${data.category}`)

  const properties = smartMapToProperties(data, liveProps)
  log?.(`mapped: ${Object.keys(properties).join(', ') || '(none)'}`)

  if (Object.keys(properties).length === 0) return { error: 'No properties could be mapped' }

  const children = buildPageChildren(data, properties)
  const page = await notion.pages.create({
    parent: { database_id: db.database_id },
    properties,
    ...(children.length ? { children } : {})
  })
  return {
    page_id: page.id,
    url: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
    mapped_properties: Object.keys(properties),
    body_blocks: children.length
  }
}

async function appendToPage(page, data, apiKey, log) {
  const notion = makeNotionClient(apiKey)
  const pageId = page.page_id || page.notion_id || page.id
  if (!pageId) return { error: 'Page id is required' }

  const children = []
  if (data.title) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: String(data.title).slice(0, 2000) } }]
      }
    })
  }
  children.push(...buildPageChildren(data, {}))

  if (!children.length) return { error: 'No text to append' }

  log?.(`append ${children.length} blocks to page ${page.title || page.name || pageId}`)
  const res = await notion.blocks.children.append({
    block_id: pageId,
    children
  })

  return {
    page_id: pageId,
    url: page.url || `https://notion.so/${pageId.replace(/-/g, '')}`,
    blocks: res.results?.length || children.length
  }
}

async function syncDbSchema(apiKey, databases, log) {
  const notion = makeNotionClient(apiKey)
  const updated = []
  for (const db of databases) {
    try {
      const live = await notion.databases.retrieve({ database_id: db.database_id })
      const properties = schemaFromNotionProperties(live.properties || {})
      const title = live.title?.[0]?.plain_text || db.name
      log?.(`synced ${title}: ${Object.keys(properties).length} props`)
      updated.push({ ...db, name: title, properties })
    } catch (err) {
      log?.(`sync error ${db.name || db.database_id}: ${err.message}`)
      updated.push(db)
    }
  }
  return updated
}

async function searchDestinations(apiKey) {
  const notion = makeNotionClient(apiKey)
  const destinations = []
  let cursor = undefined

  do {
    const res = await notion.search({
      page_size: 100,
      start_cursor: cursor,
      filter: { property: 'object', value: 'page' }
    })
    for (const item of res.results || []) {
      if (item.object === 'database' || item.object === 'data_source') {
        const dest = normalizeDatabaseDestination({
          id: item.id,
          database_id: item.id,
          name: titleFromRichText(item.title, item.id.slice(0, 8)),
          title: titleFromRichText(item.title, item.id.slice(0, 8)),
          url: item.url,
          properties: schemaFromNotionProperties(item.properties || {})
        })
        destinations.push(await enrichDatabaseDestination(notion, dest))
      } else if (item.object === 'page') {
        destinations.push(normalizePageDestination({
          id: item.id,
          page_id: item.id,
          name: titleFromPage(item),
          title: titleFromPage(item),
          url: item.url
        }))
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  cursor = undefined
  do {
    const res = await notion.search({
      page_size: 100,
      start_cursor: cursor,
      filter: { property: 'object', value: 'database' }
    })
    for (const item of res.results || []) {
      const dest = normalizeDatabaseDestination({
        id: item.id,
        database_id: item.id,
        name: titleFromRichText(item.title, item.id.slice(0, 8)),
        title: titleFromRichText(item.title, item.id.slice(0, 8)),
        url: item.url,
        properties: schemaFromNotionProperties(item.properties || {})
      })
      destinations.push(await enrichDatabaseDestination(notion, dest))
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  const seen = new Set()
  return destinations.filter(d => {
    const key = `${d.type}:${d.notion_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

module.exports = {
  name: 'notion',
  title: 'Notion',
  icon: '📄',
  description: 'База знаний Notion — задачи, заметки, хранилище, буфер',
  authFields: [
    { key: 'api_key', label: 'Internal Integration Secret', type: 'password', secret: true }
  ],

  functions: {
    saveText: {
      title: 'Сохранить текст',
      capability: 'knowledge.save_text',
      description: 'Сохранить текст в Notion. В какую БД сохранять определяет AI по имени базы.',
      params: {
        title: { type: 'string', description: 'Заголовок записи (кратко, до 8 слов)', required: true },
        text: { type: 'string', description: 'Полный текст записи', required: true },
        destination: { type: 'string', description: 'Destination id/name: database или page', optional: true },
        database: { type: 'string', description: 'Совместимость: database destination id/name', optional: true },
        category: { type: 'string', description: 'Категория из select/multi_select/status-поля таблицы', optional: true },
        date: { type: 'string', description: 'Дата YYYY-MM-DD', optional: true },
        source: { type: 'string', description: 'Источник из select/multi_select-поля таблицы', optional: true },
        priority: { type: 'string', description: 'Приоритет из select-поля', optional: true },
        status: { type: 'string', description: 'Статус из status/select-поля', optional: true },
        tags: { type: 'array', description: 'Список тегов (multi_select)', optional: true },
        url: { type: 'string', description: 'URL из url-поля таблицы', optional: true },
        email: { type: 'string', description: 'Email из email-поля', optional: true },
        phone: { type: 'string', description: 'Телефон из phone_number-поля', optional: true },
        number: { type: 'string', description: 'Число из number-поля', optional: true },
        checked: { type: 'boolean', description: 'Галочка из checkbox-поля', optional: true }
      },
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const destinationName = params.destination || params.database
        const destination = pickDestination(config, destinationName)
        if (!destination) throw new Error('No Notion destinations configured')
        const data = {
          title: params.title || params.text?.slice(0, 80) || 'Untitled',
          text: params.text || params.title || '',
          content: params.text || params.title || '',
          ...params
        }
        const result = destination.type === 'page'
          ? await appendToPage(destination, data, apiKey, msg => console.log(`[Notion:saveText] ${msg}`))
          : await writeToDatabase(destination, data, apiKey, msg => console.log(`[Notion:saveText] ${msg}`))
        if (result.error) throw new Error(result.error)
        return {
          saved: true,
          destination: destination.name || destination.title,
          destination_type: destination.type,
          database: destination.type === 'database' ? destination.name : null,
          page_id: result.page_id,
          url: result.url,
          mapped_properties: result.mapped_properties || [],
          body_blocks: result.body_blocks || result.blocks || 0
        }
      }
    },

    appendToPage: {
      title: 'Добавить текст на страницу',
      capability: 'knowledge.append_text',
      description: 'Добавить текстовые блоки в обычную страницу Notion.',
      params: {
        destination: { type: 'string', description: 'Page destination id/name', required: true },
        title: { type: 'string', description: 'Заголовок блока', optional: true },
        text: { type: 'string', description: 'Текст для добавления', required: true },
        category: { type: 'string', description: 'Категория', optional: true },
        date: { type: 'string', description: 'Дата YYYY-MM-DD', optional: true }
      },
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const destination = pickDestination(config, params.destination, 'page')
        if (!destination) throw new Error('No page destination configured')
        const data = {
          title: params.title || null,
          text: params.text || '',
          category: params.category || null,
          date: params.date || null,
          source: params.source || null
        }
        const result = await appendToPage(destination, data, apiKey, msg => console.log(`[Notion:appendToPage] ${msg}`))
        if (result.error) throw new Error(result.error)
        return {
          saved: true,
          destination: destination.name || destination.title,
          destination_type: 'page',
          page_id: result.page_id,
          url: result.url,
          body_blocks: result.blocks || 0
        }
      }
    },

    syncSchema: {
      title: 'Синхронизировать схему',
      capability: 'schema.sync',
      description: 'Синхронизировать схему БД с Notion — обновить список колонок и select-опций из живых данных.',
      params: {},
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const databases = configuredDestinations(config).filter(d => d.type === 'database')
        if (!databases.length) throw new Error('No databases configured')
        const updated = await syncDbSchema(apiKey, databases, msg => console.log(`[Notion:syncSchema] ${msg}`))
        return { databases: updated }
      }
    },

    listDestinations: {
      title: 'Список страниц и баз',
      capability: 'destinations.list',
      description: 'Показать доступные Jenn страницы и базы данных Notion.',
      params: {},
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const live = await searchDestinations(apiKey)
        const configured = configuredDestinations(config)
        const configuredByKey = new Map(configured.map(d => [`${d.type}:${d.notion_id}`, d]))
        const destinations = live.map(d => ({
          ...d,
          id: configuredByKey.get(`${d.type}:${d.notion_id}`)?.id || d.id,
          description: configuredByKey.get(`${d.type}:${d.notion_id}`)?.description || d.description || '',
          enabled: configuredByKey.has(`${d.type}:${d.notion_id}`) ? configuredByKey.get(`${d.type}:${d.notion_id}`).enabled !== false : false
        }))
        const configuredOnly = configured
          .filter(c => !live.find(d => d.type === c.type && d.notion_id === c.notion_id))
          .map(d => ({ ...d, enabled: d.enabled !== false, missing: true }))
        return { destinations: [...destinations, ...configuredOnly] }
      }
    },

    syncDestinations: {
      title: 'Синхронизировать destinations',
      capability: 'destinations.sync',
      description: 'Синхронизировать доступные страницы и базы Notion в конфиг Jenn.',
      params: {},
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const live = await searchDestinations(apiKey)
        const current = configuredDestinations(config)
        const currentByKey = new Map(current.map(d => [`${d.type}:${d.notion_id}`, d]))
        const destinations = live.map(d => ({
          ...d,
          id: currentByKey.get(`${d.type}:${d.notion_id}`)?.id || d.id,
          description: currentByKey.get(`${d.type}:${d.notion_id}`)?.description || d.description || '',
          enabled: currentByKey.has(`${d.type}:${d.notion_id}`) ? currentByKey.get(`${d.type}:${d.notion_id}`).enabled !== false : true
        }))
        return {
          destinations,
          databases: destinations.filter(d => d.type === 'database').map(d => ({
            id: d.id,
            name: d.name,
            database_id: d.database_id,
            url: d.url,
            properties: d.properties || {},
            categories: d.categories || []
          }))
        }
      }
    },

    describeDestination: {
      title: 'Описать destination',
      capability: 'destinations.describe',
      description: 'Показать структуру destination: database schema или page metadata.',
      params: {
        destination_id: { type: 'string', description: 'ID destination/page/database', required: true }
      },
      async handler(params, config) {
        const apiKey = config?.api_key
        if (!apiKey) throw new Error('Notion API key not configured')
        const destination = pickDestination(config, params.destination_id)
        if (!destination) throw new Error('Destination not configured')
        if (destination.type === 'page') {
          return {
            id: destination.id,
            type: 'page',
            title: destination.title || destination.name,
            url: destination.url,
            fields: []
          }
        }
        const notion = makeNotionClient(apiKey)
        const resp = await notion.databases.retrieve({ database_id: destination.database_id || destination.notion_id })
        const fields = Object.entries(resp.properties || {}).map(([name, prop]) => ({
          name, type: prop.type,
          options: prop.type === 'select' ? (prop.select?.options || []).map(o => o.name) : undefined
        }))
        return {
          id: destination.id,
          type: 'database',
          title: resp.title?.[0]?.plain_text || destination.name,
          fields
        }
      }
    },
  },

  async test(config) {
    const apiKey = typeof config === 'string' ? config : config?.api_key
    if (!apiKey) throw new Error('API key required')
    const notion = makeNotionClient(apiKey)
    const user = await notion.users.me({})
    return { message: `Connected as ${user.name}` }
  },

  async listDestinations(config) {
    return this.functions.listDestinations.handler({}, typeof config === 'string' ? { api_key: config } : config)
  },

  async describeDestination(config, destId) {
    return this.functions.describeDestination.handler({ destination_id: destId }, config)
  },

  async syncDestinations(config) {
    return this.functions.syncDestinations.handler({}, config)
  }
}
