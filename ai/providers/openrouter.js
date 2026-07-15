module.exports = {
  name: 'openrouter',
  requiresKey: true,

  create(key) {
    return {
      async complete(messages, options = {}) {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: options.model || 'gpt-4o-mini',
            messages,
            temperature: options.temperature ?? 0.1,
            max_tokens: options.maxTokens || 500,
            response_format: { type: 'json_object' }
          })
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`OpenRouter ${res.status}: ${text}`)
        }
        const data = await res.json()
        return data.choices[0]?.message?.content || ''
      }
    }
  }
}
