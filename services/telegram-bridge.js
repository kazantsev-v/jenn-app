const { TelegramBot } = require('node-telegram-bot-api')
const { prisma } = require('../db')

let sharedBot = null
let sharedUsers = []

const JENN_URL = process.env.JENN_URL || 'http://localhost:3000'

async function start(store) {
  const sharedToken = process.env.BOT_TOKEN

  const rows = await prisma.userConfig.findMany({
    include: { user: { select: { username: true } } },
  })
  for (const row of rows) {
    const username = row.user.username
    const tgConfig = row.data?.inputsConfig?.tg_bot
    if (!tgConfig || tgConfig.bot_mode !== 'built_in') continue

    const sourceToken = await store.getUserToken(username, 'tg_bot')
    if (!sourceToken || !tgConfig.telegram_id) continue

    sharedUsers.push({ telegramId: tgConfig.telegram_id.trim(), username, sourceToken })
  }

  if (sharedUsers.length > 0 && sharedToken) {
    startSharedBot(sharedToken)
  }

  if (sharedBot) console.log(`[TG Bridge] Shared bot for ${sharedUsers.length} user(s): ${sharedUsers.map(u => u.username).join(', ')}`)
}

function startSharedBot(sharedToken) {
  if (sharedBot) return
  sharedBot = new TelegramBot(sharedToken, {
    polling: true,
    baseApiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org'
  })

  sharedBot.on('message', (msg) => {
    const senderId = String(msg.from?.id)
    const senderUsername = msg.from?.username
    const match = sharedUsers.find(u =>
      u.telegramId === senderId ||
      u.telegramId === senderUsername ||
      u.telegramId === `@${senderUsername}`
    )
    if (!match) {
      return sharedBot.sendMessage(msg.chat.id,
        '❌ Вы не зарегистрированы.\nНастройте Telegram ID в админ-панели Jenn.'
      )
    }
    handleMessage(sharedBot, msg, match.username, match.sourceToken)
  })
  console.log(`[TG Bridge] Shared bot for ${sharedUsers.length} user(s): ${sharedUsers.map(u => u.username).join(', ')}`)
}

async function isCoreReachable() {
  try {
    const res = await fetch(`${JENN_URL}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function handleMessage(bot, msg, username, sourceToken) {
  if (!msg.text) return

  if (msg.text === '/start') {
    return bot.sendMessage(msg.chat.id,
      '👋 Привет! Я Jenn — твой помощник для заметок.\n\n' +
      'Просто напиши текст, и я сохраню его куда нужно:\n' +
      '• Идеи и мысли\n' +
      '• Задачи и дела\n' +
      '• Ссылки и статьи\n' +
      '• Любую информацию\n\n' +
      'Попробуй: "Запомни идею про запуск канала"\n' +
      'Или просто напиши что угодно — я разберусь 🙌'
    )
  }

  const coreUp = await isCoreReachable()
  if (!coreUp) {
    return bot.sendMessage(msg.chat.id,
      '⚠️ Jenn сейчас недоступна.\n\n' +
      'Попробуй написать позже — я сохраню всё когда система снова заработает.'
    )
  }

  try {
    const res = await fetch(`${JENN_URL}/v1/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sourceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'tg_bot',
        text: msg.text,
        user: {
          id: String(msg.from.id),
          name: msg.from.first_name || msg.from.username || 'unknown'
        },
        meta: {
          chat_id: msg.chat.id,
          message_type: msg.chat.type
        }
      })
    })

    const data = await res.json()

    if (res.ok) {
      const result = data.result
      let reply = '✅ Принято!'
      if (result?.action?.params?.title) {
        reply += `\n📌 ${result.action.params.title}`
      }
      if (result?.result?.url) {
        reply += `\n🔗 ${result.result.url}`
      }
      if (result?.result?.destination) {
        const dest = result.result.destination
        const output = result?.action?.tool?.split('.')[0] || ''
        reply += `\n📂 В: ${dest}${output ? ` (${output})` : ''}`
      }
      bot.sendMessage(msg.chat.id, reply)
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${data.message || 'Неизвестная ошибка'}`)
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Ошибка соединения: ${err.message}`)
  }
}

function stop() {
  if (sharedBot) {
    try { sharedBot.stopPolling() } catch {}
    sharedBot = null
  }
  sharedUsers = []
}

module.exports = { start, stop }
