const GroqSDK = require('groq-sdk')

module.exports = {
  name: 'groq',
  requiresKey: true,

  create(key) {
    const client = new GroqSDK({ apiKey: key })
    return {
      async complete(messages, options = {}) {
        const res = await client.chat.completions.create({
          model: options.model || 'llama-3.3-70b-versatile',
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens || 500,
          response_format: { type: 'json_object' }
        })
        return res.choices[0]?.message?.content || ''
      }
    }
  }
}
