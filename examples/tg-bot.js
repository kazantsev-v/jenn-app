// Telegram Bot → Jenn Server
// npm install node-telegram-bot-api
// BOT_TOKEN=xxx ALLOWED_IDS=123,@user JENN_TOKEN=xxx node examples/tg-bot.js

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const TelegramBot = require('node-telegram-bot-api')

const BOT_TOKEN = process.env.BOT_TOKEN
const JENN_URL = process.env.JENN_URL || 'http://localhost:3000'
const JENN_TOKEN = process.env.JENN_TOKEN || '422cdf43-139d-4b7b-a4a3-aa8237eaa6d4'
const ALLOWED_IDS = (process.env.ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required')
  process.exit(1)
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

bot.on('message', async (msg) => {
  if (!msg.text) return

  if (ALLOWED_IDS.length > 0) {
    const senderId = String(msg.from.id)
    const senderUsername = msg.from?.username
    const allowed = ALLOWED_IDS.some(id =>
      id === senderId || id === senderUsername || id === `@${senderUsername}`
    )
    if (!allowed) {
      return bot.sendMessage(msg.chat.id, '❌ Вы не в белом списке')
    }
  }

  try {
    const res = await fetch(`${JENN_URL}/v1/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JENN_TOKEN}`,
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
      if (result?.action?.params?.title) reply += `\n📌 ${result.action.params.title}`
      if (result?.result?.url) reply += `\n🔗 ${result.result.url}`
      if (result?.result?.destination) {
        const dest = result.result.destination
        const output = result?.action?.tool?.split('.')[0] || ''
        reply += `\n📂 В: ${dest}${output ? ` (${output})` : ''}`
      }
      bot.sendMessage(msg.chat.id, reply)
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${data.message || 'Ошибка'}`)
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Ошибка соединения: ${err.message}`)
    console.error('[Jenn] Connection error:', err.message)
  }
})

console.log('Telegram bot is running...')
