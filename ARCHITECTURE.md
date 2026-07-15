# Архитектура Jenn: ядро + Output-плагины

## Философия

Jenn — это **ядро**, которое ничего не знает о внешнем мире. Оно получает сообщение, определяет намерение (AI) и отдаёт результат output-плагину.

Output-плагин **сам описывает себя** — какие у него есть места назначения (destinations), какие поля/свойства они принимают, какие типы данных. Core на основе этих описаний строит промпт для AI, и AI принимает решение: **куда** и **с какими полями** сохранить данные.

Разработчик любого нового output-а (Telegram, email, файлы, кастомный API) просто реализует единый контракт — и AI автоматически понимает, как с ним работать.

---

## Контракт output-плагина

Каждый output — это Node.js модуль, экспортирующий:

### 1. `describe(outputConfig)` — статическое описание

```js
module.exports.describe = function(outputConfig) {
  return {
    id: 'notion',
    name: 'Notion',
    description: 'База знаний Notion — задачи, заметки, хранилище',
    destinations: [
      {
        id: 'tasks',
        name: 'Задачи',
        description: 'Для рабочих задач, поручений, отслеживания дедлайнов',
        properties: {
          'Название':   { type: 'title',   required: true },
          'Статус':     { type: 'select',  options: ['К выполнению', 'В работе', 'Готово'], required: true },
          'Категория':  { type: 'select',  options: ['Работа', 'Спорт', 'Личное'], required: false },
          'Срок':       { type: 'date',    required: false }
        }
      },
      {
        id: 'storage',
        name: 'Хранилище',
        description: 'Для заметок, идей, новостей, ссылок',
        properties: {
          'Название':   { type: 'title',   required: true },
          'Текст':      { type: 'rich_text', required: false },
          'Категория':  { type: 'select',  options: ['Заметка', 'Новость', 'Идея'], required: false },
          'Источник':   { type: 'select',  options: ['TG', 'Desktop', 'Email', 'Ссылка'], required: false },
          'Дата':       { type: 'date',    required: false }
        }
      }
    ]
  }
}
```

Параметр `outputConfig` — секция конфига пользователя для этого output-а
(например, `cfg.outputs.notion`). Output сам решает, что и как показывать.

### 2. `send(data, config)` — отправка данных

```js
module.exports.send = async function(data, config) {
  // data — результат выполнения навыка
  // config._destination — id выбранного AI места назначения (если есть)
  // config.outputConfig — секция конфига пользователя
  ...
}
```

Core передаёт в `config`:
- `_username` — для авто-сохранения конфига
- `_destination` — `id` места назначения, выбранного AI (если AI его указал)
- Все остальные поля из `cfg.outputs[outputName]`

---

## Поток обработки сообщения

```
Сообщение (текст, source, user)
    │
    ▼
┌─────────────────────────────────────────────┐
│  Core: Processor.process()                   │
│  1. Загружает config пользователя             │
│  2. Собирает описания со всех output-ов       │
│     (вызывает describe(cfg.outputs[name]))   │
│  3. Передаёт в AI:                           │
│     - список навыков                          │
│     - descriptions от output-ов              │
│     - правила маршрутизации по умолчанию     │
│     - текст пользователя                     │
│  4. AI возвращает:                           │
│     { skill, params, output?, destination? } │
│  5. Определяет output:                       │
│     intent.output                           │
│     ?? skillsOutputs[skill.name]             │
│     ?? defaultOutput                         │
│  6. Определяет destination:                  │
│     intent.destination ?? null               │
│  7. Выполняет skill.handler(params, message) │
│  8. Передаёт результат в output.send()       │
│     с _destination = intent.destination       │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  Output-плагин (notion, tg, email, ...)      │
│  - Если config._destination указан →         │
│    используем его напрямую                   │
│  - Иначе → fallback-логика плагина           │
│    (например, поиск БД по категории)          │
│  - Создаёт/отправляет сущность               │
│  - Возвращает детали (id, url, error)         │
└─────────────────────────────────────────────┘
```

---

## Формат промпта для AI

```
Ты — ядро системы Jenn. Определи намерение пользователя.

ДОСТУПНЫЕ НАВЫКИ:
1. save_entry — "Сохранить текст"
   Описание: Сохраняет любую информацию — заметки, задачи, идеи,
   ссылки, поручения. AI сам определяет категорию и куда сохранить.
   Параметры: text (текст), category (категория, опционально),
              source_url (ссылка, опционально)

2. create_reminder — "Напоминание"
   Описание: Создаёт напоминание с текстом и датой/временем.
   Параметры: text (текст), datetime (дата и время)

3. create_note — "Заметка"
   Описание: Создаёт краткую заметку с заголовком.
   Параметры: title (заголовок), content (содержимое)

МЕСТА НАЗНАЧЕНИЯ (OUTPUTS):

→ notion (База знаний Notion)
  Описание: База знаний, задачи, заметки в Notion

  Доступные базы:
  📁 tasks — "Задачи"
    Для рабочих задач, поручений, отслеживания дедлайнов.
    Поля:
    - Название (title) — обязательно
    - Статус (select): [К выполнению, В работе, Готово]
    - Категория (select): [Работа, Спорт, Личное]
    - Срок (date)

  📁 storage — "Хранилище"
    Для заметок, идей, новостей, ссылок.
    Поля:
    - Название (title) — обязательно
    - Текст (rich_text)
    - Категория (select): [Заметка, Новость, Идея]
    - Источник (select): [TG, Desktop, Email, Ссылка]
    - Дата (date)

  📁 incoming — "Входящее"
    Для неклассифицированных записей.
    Поля:
    - Название (title) — обязательно
    - Текст (rich_text)
    - Категория (select): [Заметка, Новость, Идея, Задача, Ссылка]
    - Дата (date)

→ jenn (Внутреннее хранилище)
  ... (описывается, если подключен)

МАРШРУТИЗАЦИЯ ПО УМОЛЧАНИЮ:
  save_entry → notion
  create_reminder → notion (через defaultOutput)

ПРАВИЛА:
- Рабочие задачи, поручения, дедлайны → save_entry → notion → tasks
- Личное, хобби, идеи → save_entry → notion → storage
- Срочное, неклассифицированное → save_entry → notion → incoming
- Напоминания на дату → create_reminder → notion

Ты МОЖЕШЬ переопределить output и destination,
вернув поля "output" и "destination" в JSON-ответе.

Формат ответа:
{"skill": "имя_навыка", "params": {...}, "output": "notion", "destination": "tasks"}
```

---

## Расширение ответа AI

```js
// Было:
{ skill: 'save_entry', params: { text: 'сделать отчет', category: 'Задача' } }

// Стало:
{
  skill: 'save_entry',
  params: { text: 'сделать отчет к пятнице', category: 'Задача' },
  output: 'notion',
  destination: 'tasks'
}
```

---

## Изменения в processor.js

```js
async process(message, username) {
  const cfg = this.userConfig(username)
  const skillsList = [...this.skills.values()]

  // 1. Собираем описания output-ов
  const outputDescriptions = {}
  for (const [name, output] of this.outputs) {
    if (typeof output.describe === 'function') {
      outputDescriptions[name] = output.describe(cfg?.outputs?.[name])
    }
  }

  // 2. AI с полным контекстом
  const intent = await this.ai.determineIntent(
    skillsList, message.text, outputDescriptions, cfg
  )

  // 3. Определяем output (AI > конфиг > default)
  let outputName = intent.output
    || cfg.skillsOutputs?.[intent.skill]
    || cfg.defaultOutput

  // 4. Передаём destination в output-конфиг
  const outputConfig = {
    ...(cfg?.outputs?.[outputName] || {}),
    _username: username,
    _destination: intent.destination || null
  }

  // 5. Выполняем навык и отправляем
  const result = await skill.handler(params, message)
  output.send(result, outputConfig)
}
```

---

## Изменения в notion output

### describe(outputConfig)

```js
module.exports.describe = function(outputConfig) {
  if (!outputConfig?.databases) return null

  return {
    id: 'notion',
    name: 'Notion',
    description: 'База знаний Notion',
    destinations: outputConfig.databases.map(db => ({
      id: db.id,
      name: db.name,
      description: '', // можно добавить в конфиг
      properties: Object.fromEntries(
        Object.entries(db.properties || {}).map(([key, prop]) => [
          key,
          {
            type: prop.type,
            options: prop.options || null,
            required: typeof prop.value === 'string' && prop.value.includes('{{')
          }
        ])
      )
    }))
  }
}
```

### send(data, config) — уважать _destination

```js
let db
if (config._destination) {
  db = config.databases.find(d => d.id === config._destination)
}
if (!db) {
  db = findTargetDb(data, config) // существующая логика
}
```

---

## Что делать, если output не имеет describe()

Если output старый (без `describe()`):
- Core просто не включает его в промпт
- Маршрутизация работает по старым правилам (`skillsOutputs` / `defaultOutput`)
- AI не знает про этот output, но система не ломается

---

## План реализации

1. **`outputs/notion.js`** — добавить `describe()`, уважать `_destination` в `send()`
2. **`core/processor.js`** — собирать `outputDescriptions`, передавать `cfg` и `descriptions` в AI, AI-controlled routing
3. **`ai/prompt.js`** — `buildRichPrompt(skills, outputDescriptions, skillsOutputs, defaultOutput)`
4. **`ai/router.js`** — `determineIntent(skills, userText, outputDescriptions, cfg)`, парсить `output` и `destination` из ответа AI
5. **Документация** — `ARCHITECTURE.md` (этот файл) для разработчиков output-плагинов
