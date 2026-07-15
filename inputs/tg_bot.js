module.exports = {
  name: 'tg_bot',
  title: 'Telegram Bot',
  description: 'Получать сообщения из Telegram',
  icon: '🤖',
  author: 'Jenn Core',
  version: '1.2.0',
  configFields: [
    {
      key: 'bot_mode', label: 'Режим бота', type: 'select',
      options: [
        { value: 'built_in', label: 'Встроенный бот (публичный)' },
        { value: 'self_hosted', label: 'Свой бот' }
      ]
    },
    {
      key: 'telegram_id', label: 'Ваш Telegram ID или @username', type: 'text',
      placeholder: 'Например: 123456789 или @username',
      showIf: { bot_mode: 'built_in' }
    },
    {
      key: 'allowed_ids', label: 'Белый список (ID или @username)', type: 'text',
      placeholder: '123456789, @user, 987654',
      showIf: { bot_mode: 'self_hosted' }
    }
  ],
  async test(config) {
    const https = require('https')
    const mode = config?.bot_mode || 'built_in'

    if (mode === 'self_hosted') {
      return { message: 'Свой бот — запустите examples/tg-bot.js с вашим токеном' }
    }

    const sharedToken = process.env.BOT_TOKEN
    if (!sharedToken) throw new Error('BOT_TOKEN не задан в .env')
    const body = await new Promise((resolve, reject) => {
      const req = https.get(`https://api.telegram.org/bot${sharedToken}/getMe`, { timeout: 10000 }, res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => resolve(d))
      })
      req.on('error', reject)
    })
    const data = JSON.parse(body)
    if (!data.ok) throw new Error(data.description || 'Telegram API error')
    if (!config?.telegram_id) throw new Error('Укажите ваш Telegram ID или @username')
    return { message: `Публичный бот @${data.result.username} доступен. Ваш ID: ${config.telegram_id}` }
  }
}
