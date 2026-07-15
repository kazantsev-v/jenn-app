require('dotenv').config()
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000'
const TOKEN = process.env.TOKEN || 'test-token-550e8400'
const SOURCE = process.env.SOURCE || 'cli'

function ask() {
  rl.question('> ', async (text) => {
    if (text === 'exit' || text === 'quit') {
      rl.close()
      return
    }
    try {
      const res = await fetch(`${SERVER_URL}/v1/message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: SOURCE,
          text,
          user: { id: 'test', name: 'Test User' }
        })
      })
      const data = await res.json()
      if (res.ok) {
        console.log(`OK  id=${data.message_id}`)
      } else {
        console.log(`ERR ${data.error}: ${data.message}`)
      }
    } catch (err) {
      console.error('Connection error:', err.message)
    }
    ask()
  })
}

console.log(`Jenn Client — ${SOURCE} @ ${SERVER_URL}`)
console.log('Type text and press Enter (exit/quit to stop)')
ask()
