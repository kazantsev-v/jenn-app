# Jenn Output Plugin Contract

Jenn treats every output as a provider of callable functions. Notion is not special: it is just one output that exposes functions such as `saveText`.

## Minimal output shape

```js
module.exports = {
  name: 'my_output',
  title: 'My Output',
  description: 'Where Jenn can send data',

  authFields: [
    { key: 'api_key', label: 'API Key', type: 'password', secret: true }
  ],

  functions: {
    saveText: {
      title: 'Save text',
      capability: 'knowledge.save_text',
      description: 'Save a note, idea, task, link, or any text payload.',
      params: {
        title: { type: 'string', required: true },
        text: { type: 'string', required: true },
        database: { type: 'string', required: false },
        date: { type: 'string', required: false }
      },

      async handler(params, config, context) {
        // params: normalized data chosen by Jenn/AI/skill
        // config: user config for this output, e.g. cfg.outputs.my_output
        // context: execution metadata: output, function, capability, skill, message
        return { ok: true }
      }
    }
  }
}
```

## Destinations

Outputs may expose destinations: places inside the external app where Jenn can send data. A destination can be a database, page, chat, sheet, folder, or any other target.

```js
module.exports = {
  async listDestinations(config) {
    return {
      destinations: [
        {
          id: 'incoming',
          type: 'database',
          name: 'Входящее',
          notion_id: '...',
          properties: {
            Name: { type: 'title' },
            Категория: { type: 'select', options: ['Идея', 'Задача'] }
          }
        },
        {
          id: 'wiki',
          type: 'page',
          name: 'Life Wiki',
          notion_id: '...'
        }
      ]
    }
  },

  async syncDestinations(config) {
    // Pull live destinations from the external app and return config-ready data.
    return { destinations: [] }
  },

  async describeDestination(config, destinationId) {
    return { id: destinationId, type: 'database', fields: [] }
  }
}
```

## Core rule

Outputs declare functions. Skills return actions. Jenn Core connects them.

```txt
Input → Jenn Core → Skill → action/capability → Output function → external app
```

Core skills should return an action like this:

```js
return {
  action: {
    capability: 'knowledge.save_text',
    output: skillConfig.output,
    function: 'saveText',
    params: { title, text, category, date, database }
  },
  preview: { title, text }
}
```

Then `Processor` resolves the action to a configured output function and executes it.

## Recommended capability names

- `knowledge.save_text` — save a note, idea, link, task-like text.
- `tasks.create` — create a task in a task system.
- `messages.send` — send a message to a chat/channel.
- `table.append_row` — append structured data to a table.
- `files.create` — create a file/document.
- `destinations.list` — list available target destinations.
- `destinations.describe` — describe a target schema.
- `schema.sync` — sync external schema into Jenn config.

When adding a new output, prefer reusing an existing capability before inventing a new one.
