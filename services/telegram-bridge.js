const { TelegramBot } = require('node-telegram-bot-api')
const { prisma } = require('../db')

let sharedBot = null
const userCache = new Map()

const JENN_URL = process.env.JENN_URL || 'http://localhost:3000'
const CACHE_TTL = 60_000

async function start(store) {
  const sharedToken = process.env.BOT_TOKEN
  if (!sharedToken) return
  startSharedBot(sharedToken)
}

async function findUserByTelegram(senderId, senderUsername, store) {
  const keys = [senderId]
  if (senderUsername) {
    keys.push(senderUsername, `@${senderUsername}`)
  }

  for (const key of keys) {
    const cached = userCache.get(key)
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
  }

  const rows = await prisma.userConfig.findMany({
    include: { user: { select: { username: true } } },
  })

  for (const row of rows) {
    const tgConfig = row.data?.inputsConfig?.tg_bot
    if (!tgConfig || tgConfig.bot_mode !== 'built_in' || !tgConfig.telegram_id) continue

    const telegramId = tgConfig.telegram_id.trim()
    const username = row.user.username
    const sourceToken = await store.getUserToken(username, 'tg_bot')
    if (!sourceToken) continue

    const userData = { telegramId, username, sourceToken }

    userCache.set(telegramId, { data: userData, ts: Date.now() })
    if (username) userCache.set(username, { data: userData, ts: Date.now() })
    userCache.set(`@${username}`, { data: userData, ts: Date.now() })
  }

  for (const key of keys) {
    const cached = userCache.get(key)
    if (cached) return cached.data
  }

  return null
}

function startSharedBot(sharedToken) {
  if (sharedBot) return
  sharedBot = new TelegramBot(sharedToken, {
    polling: true,
    baseApiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org'
  })

  sharedBot.on('message', async (msg) => {
    const senderId = String(msg.from?.id)
    const senderUsername = msg.from?.username

    const match = await findUserByTelegram(senderId, senderUsername, require('../store'))
    if (!match) {
      return sharedBot.sendMessage(msg.chat.id,
        '❌ Вы не зарегистрированы в системе Jenn.\n\n' +
        '📋 Инструкция по настройке:\n\n' +
        '1. Откройте консоль: https://jenn-app.tech/console\n' +
        '2. Зарегистрируйтесь или войдите в аккаунт\n' +
        '3. Перейдите в раздел "Pipeline"\n' +
        '4. Выберите "Input Telegram"\n' +
        '5. Укажите ваш Telegram: @' + (senderUsername || senderId) + '\n' +
        '6. Сохраните настройки\n\n' +
        'После этого я смогу сохранять ваши сообщения!'
      )
    }
    handleMessage(sharedBot, msg, match.username, match.sourceToken)
  })
  console.log(`[TG Bridge] Shared bot started (dynamic user lookup)`)
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
        reply += `\n🔗 <a href="${result.result.url}">ссылка</a>`
      }
      if (result?.result?.destination) {
        const dest = result.result.destination
        const output = result?.action?.tool?.split('.')[0] || ''
        reply += `\n📂 В: ${dest}${output ? ` (${output})` : ''}`
      }
      bot.sendMessage(msg.chat.id, reply, { parse_mode: 'HTML' })
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
  userCache.clear()
}

module.exports = { start, stop }
