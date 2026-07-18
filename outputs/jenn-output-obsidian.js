const crypto = require('crypto')
const { WebSocketServer } = require('ws')
const store = require('../store')

let _wss = null
// ponytail: multi-client — Map<username, ws>. One active plugin per user.
const _clients = new Map()
let _pending = new Map()
let _port = 11235

function callObsidian(username, type, payload) {
  const ws = _clients.get(username)
  if (!ws) throw new Error(`Obsidian plugin not connected for user "${username}"`)
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      _pending.delete(id)
      reject(new Error('Obsidian response timeout'))
    }, 15000)
    _pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ type, id, payload: payload || {} }))
  })
}

function stop() {
  for (const [, p] of _pending) { clearTimeout(p.timeout); p.reject(new Error('Obsidian stopped')) }
  _pending.clear()
  for (const [, ws] of _clients) { try { ws.close() } catch {} }
  _clients.clear()
  if (_wss) { try { _wss.close() } catch {}; _wss = null }
}

module.exports = {
  name: 'obsidian',
  title: 'Obsidian',
  icon: '🪨',
  description: 'Vault Obsidian — заметки, хранилище, база знаний',
  authFields: [],

  getConfig(config) {
    const port = parseInt(config?.ws_port) || 11235
    const host = process.env.DOMAIN || 'localhost'
    const protocol = host === 'localhost' ? 'ws' : 'wss'
    const wsUrl = host === 'localhost'
      ? `${protocol}://${host}:${port}`
      : `${protocol}://${host}`
    return { ws_port: port, ws_url: wsUrl }
  },

  async init(config, options = {}) {
    stop()
    const cfg = this.getConfig(config)

    // Если передан wss сервер (через HTTPS) — используем его
    if (options.wss) {
      _wss = options.wss
      console.log(`[Obsidian] Using shared WebSocket server (HTTPS)`)
    } else {
      // Иначе создаём свой сервер (для localhost/dev)
      _port = cfg.ws_port
      _wss = new WebSocketServer({ port: _port, host: '0.0.0.0' })
      console.log(`[Obsidian] Server listening on port ${_port}`)
    }

    _wss.on('connection', (ws) => {
      const authTimeout = setTimeout(() => { try { ws.close() } catch {} }, 5000)
      let authedUser = null

      ws.on('message', async (raw) => {
        let msg
        try { msg = JSON.parse(raw.toString()) } catch { return }

        // auth phase: first message must be { type: 'auth', payload: { key } }
        if (!authedUser && msg.type === 'auth') {
          const info = await store.getSourceByToken(msg.payload?.key).catch(() => null)
          if (info && info.source === 'obsidian') {
            clearTimeout(authTimeout)
            authedUser = info.username
            // replace previous connection of same user
            const prev = _clients.get(authedUser)
            if (prev && prev !== ws) try { prev.close() } catch {}
            _clients.set(authedUser, ws)
            ws.send(JSON.stringify({ id: msg.id, status: 'ok' }))
            console.log(`[Obsidian] Plugin connected (user ${authedUser})`)
            return
          }
          ws.send(JSON.stringify({ id: msg.id, status: 'error', error: 'Invalid key' }))
          try { ws.close() } catch {}
          return
        }

        // response to a pending RPC we sent
        if (msg.id && _pending.has(msg.id)) {
          const p = _pending.get(msg.id)
          clearTimeout(p.timeout)
          _pending.delete(msg.id)
          if (msg.status === 'error') p.reject(new Error(msg.error || 'Obsidian error'))
          else p.resolve(msg.result)
          return
        }
      })

      ws.on('close', () => {
        if (authedUser && _clients.get(authedUser) === ws) {
          _clients.delete(authedUser)
          console.log(`[Obsidian] Plugin disconnected (user ${authedUser})`)
          for (const [id, p] of _pending) { clearTimeout(p.timeout); p.reject(new Error('Obsidian disconnected')) }
          _pending.clear()
        }
        clearTimeout(authTimeout)
      })
    })

    _wss.on('error', (err) => console.error(`[Obsidian] ${err.message}`))
    console.log(`[Obsidian] Server listening on port ${_port}`)
  },

  functions: {
    saveText: {
      title: 'Сохранить заметку',
      capability: 'knowledge.save_text',
      description: 'Создать новый .md файл в Obsidian. Если файл существует — нумерация (1), (2).',
      params: {
        title: { type: 'string', required: true, description: 'Имя файла (без .md)' },
        text: { type: 'string', required: true, description: 'Markdown-содержимое' },
        folder: { type: 'string', required: false, description: 'Папка назначения от корня vault' },
        tags: { type: 'array', required: false, description: 'Список тегов' },
        date: { type: 'string', required: false, description: 'Дата YYYY-MM-DD' },
        source: { type: 'string', required: false, description: 'Источник' },
      },
      async handler(params, config, context) {
        const username = context?.username || context?.userConfig && null
        if (!username) throw new Error('No user context for obsidian output')
        return callObsidian(username, 'write_note', {
          title: params.title,
          content: params.text,
          folder: params.folder || config.folder || '',
          tags: params.tags || [],
          date: params.date || null,
          source: params.source || null,
        })
      },
    },

    appendToNote: {
      title: 'Дописать в заметку',
      capability: 'knowledge.append_text',
      description: 'Дописать markdown-текст в конец существующего файла.',
      params: {
        path: { type: 'string', required: true, description: 'Путь к файлу от корня vault' },
        text: { type: 'string', required: true, description: 'Markdown для добавления' },
        as_section: { type: 'string', required: false, description: 'Имя секции (заголовок-разделитель)' },
      },
      async handler(params, config, context) {
        if (!context?.username) throw new Error('No user context for obsidian output')
        return callObsidian(context.username, 'append_note', {
          path: params.path,
          content: params.text,
          as_section: params.as_section || null,
        })
      },
    },

    getVaultTree: {
      title: 'Дерево vault',
      capability: 'knowledge.list_structure',
      description: 'Вернуть полное дерево папок и файлов vault для принятия решений AI.',
      params: {},
      async handler(params, config, context) {
        if (!context?.username) throw new Error('No user context for obsidian output')
        return callObsidian(context.username, 'get_vault_tree', {})
      },
    },

    describeFolder: {
      title: 'Описать папку',
      capability: 'destinations.describe',
      description: 'Показать содержимое и метаданные папки vault.',
      params: {
        path: { type: 'string', required: true, description: 'Путь к папке от корня' },
      },
      async handler(params, config, context) {
        if (!context?.username) throw new Error('No user context for obsidian output')
        return callObsidian(context.username, 'describe_folder', { path: params.path })
      },
    },

    searchNotes: {
      title: 'Поиск заметок',
      capability: 'knowledge.search',
      description: 'Поиск заметок в vault по названию или содержимому.',
      params: {
        query: { type: 'string', required: true, description: 'Строка поиска' },
        folder: { type: 'string', required: false, description: 'Ограничить папкой' },
        limit: { type: 'number', required: false, description: 'Макс. результатов' },
      },
      async handler(params, config, context) {
        if (!context?.username) throw new Error('No user context for obsidian output')
        return callObsidian(context.username, 'search_notes', {
          query: params.query,
          folder: params.folder || null,
          limit: params.limit || 20,
        })
      },
    },
  },

  // ponytail: listDestinations/describeDestination/syncDestinations need username —
  // called from admin routes which pass config only. Resolve via store token lookup.
  async listDestinations(config, username) {
    if (!username) return { destinations: [] }
    const result = await callObsidian(username, 'list_destinations', {})
    const folders = result?.destinations || []
    return {
      destinations: folders.map(f => ({
        id: f.path, type: 'folder', name: f.name, path: f.path,
        file_count: f.file_count || 0, folders: f.folders || [],
      })),
    }
  },

  async describeDestination(config, destId, username) {
    if (!username) return { id: destId, type: 'folder', files: [], folders: [] }
    const result = await callObsidian(username, 'describe_folder', { path: destId })
    return result || { id: destId, type: 'folder', files: [], folders: [] }
  },

  async syncDestinations(config, username) {
    return this.listDestinations(config, username)
  },

  async test(config, username) {
    if (!username) return { message: 'Obsidian output configured (install to get API key)' }
    const connected = _clients.has(username)
    return { message: connected ? `Obsidian connected (user ${username})` : 'Obsidian output configured, plugin not connected' }
  },

  stop,
}
