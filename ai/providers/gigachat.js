const https = require('https')
const { GigaChat } = require('gigachat')

module.exports = {
  name: 'gigachat',
  requiresKey: true,

  create(key) {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })

    const client = new GigaChat({
      credentials: key,
      baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
      model: 'GigaChat',
      scope: 'GIGACHAT_API_PERS',
      timeout: 600,
      httpsAgent
    })

    return {
      async complete(messages, options = {}) {
        const res = await client.chat({
          model: options.model || 'GigaChat',
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens || 500
        })
        return res.choices[0]?.message?.content || ''
      }
    }
  }
}
