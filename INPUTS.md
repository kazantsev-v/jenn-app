# Input plugins — создание и добавление новых источников в Jenn

Input-плагины позволяют добавлять новые источники входящих сообщений (Telegram, HTTP-вебхуки, Desktop и т.д.). Каждый input — это отдельный `.js` файл в папке `inputs/`, который описывает метаданные источника и его настройки.

---

## Структура input-плагина

```js
// inputs/my_input.js
module.exports = {
  name: 'my_input',          // Уникальный ID (латиница, нижнее подчёркивание)
  title: 'My Input',         // Отображаемое имя в админке
  description: 'Описание',   // Краткое описание (до 100 символов)
  icon: '🔌',                // Эмодзи-иконка
  author: 'Developer',       // Автор
  version: '1.0.0',          // Версия

  // Поля конфигурации (отображаются в модалке при клике на input в Routes)
  configFields: [
    {
      key: 'api_key',             // Ключ для хранения (в inputsConfig пользователя)
      label: 'API Key',           // Подпись поля
      type: 'text',               // text | password | number | select
      secret: true,               // true = поле типа password (значение скрыто)
      placeholder: 'Введите ключ' // Подсказка в поле
    }
  ]
}
```

### Поле `configFields`

Массив объектов, каждый описывает одно поле формы.

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| `key` | string | да | Ключ для сохранения в конфиге |
| `label` | string | да | Текст над полем |
| `type` | string | нет | `text` (по умолч.), `password`, `number`, `select` |
| `secret` | boolean | нет | `true` → `<input type="password">` |
| `placeholder` | string | нет | Подсказка внутри поля |
| `required` | boolean | нет | Пока не влияет на валидацию, для документации |
| `options` | string[] | для `type: select` | Варианты выбора |

---

## Как создать и добавить новый input

### 1. Создайте файл в `inputs/`

```
inputs/
├── tg_bot.js        # Существующий
├── my_input.js      # Ваш новый input
```

### 2. Опишите плагин

```js
// inputs/http_webhook.js
module.exports = {
  name: 'http_webhook',
  title: 'HTTP Webhook',
  description: 'Принимает сообщения через HTTP POST вебхук',
  icon: '🌐',
  author: 'My Company',
  version: '1.0.0',
  configFields: [
    {
      key: 'webhook_secret',
      label: 'Webhook Secret',
      type: 'text',
      secret: true,
      placeholder: 'Секрет для подписи запросов'
    },
    {
      key: 'format',
      label: 'Формат сообщений',
      type: 'select',
      options: ['plain', 'json', 'form-data'],
      placeholder: 'Выберите формат'
    }
  ]
}
```

### 3. Перезапустите сервер

```bash
node index.js
```

При старте сервер автоматически сканирует `inputs/` и загружает все `.js` файлы:

```
[Inputs] Loaded: tg_bot
[Inputs] Loaded: http_webhook
```

### 4. Используйте в админке

1. Откройте Routes → нажмите **➕ Add input**
2. В библиотеке появится ваш input с иконкой и описанием
3. Нажмите **Install** — input добавится на панель, автоматически создастся source-токен
4. Кликните по карточке input — откроется модалка с полями из `configFields` и токеном
5. Заполните настройки и нажмите **Save**

---

## Как input отправляет сообщения

Input-плагин **не содержит логики отправки** — это задача внешнего клиента. Input только описывает настройки для админки.

Внешний клиент (Telegram bot, скрипт, вебхук) отправляет POST на сервер:

```
POST /v1/message
Authorization: Bearer <source-token>
Content-Type: application/json

{
  "source": "my_input",
  "text": "Текст сообщения",
  "user": { "id": "user123", "name": "Иван" },
  "meta": {}
}
```

- `<source-token>` — токен, показанный в модалке input (кнопка Copy)
- `source` — должен совпадать с именем input

Токен создаётся автоматически при установке input через админку.

---

## Пример: Telegram Bot (tg_bot)

Файл `inputs/tg_bot.js`:

```js
module.exports = {
  name: 'tg_bot',
  title: 'Telegram Bot',
  description: 'Получать сообщения из Telegram',
  icon: '🤖',
  author: 'Jenn Core',
  version: '1.0.0',
  configFields: [
    { key: 'bot_token', label: 'Bot Token', type: 'text', secret: true, placeholder: 'Введите токен бота' },
    { key: 'chat_id', label: 'Chat ID', type: 'text', placeholder: 'ID чата для отправки' }
  ]
}
```

Внешний клиент `examples/tg-bot.js` использует эти настройки для подключения к Telegram API.

---

## Хранение конфигов

Настройки input хранятся в конфиге пользователя (`data/configs/{username}.json`):

```json
{
  "inputs": ["tg_bot", "http_webhook"],
  "inputsConfig": {
    "tg_bot": {
      "bot_token": "123456:ABC-DEF",
      "chat_id": "987654321"
    },
    "http_webhook": {
      "webhook_secret": "my-secret",
      "format": "json"
    }
  },
  ...
}
```

---

## API endpoints для input-плагинов

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/v1/admin/inputs` | Список установленных inputs |
| GET | `/v1/admin/inputs/library` | Все доступные input-плагины |
| POST | `/v1/admin/inputs/:name/install` | Установить input + создать токен |
| DELETE | `/v1/admin/inputs/:name` | Удалить input + токен |
| GET | `/v1/admin/inputs/:name/config` | Получить configFields + текущие значения + токен |
| PUT | `/v1/admin/inputs/:name/config` | Сохранить настройки input |

---

## Загрузка при старте

Сервер сканирует `inputs/` при запуске (аналогично `skills/` и `outputs/`):

```js
const inputsDir = path.join(__dirname, 'inputs')
if (fs.existsSync(inputsDir)) {
  for (const f of fs.readdirSync(inputsDir)) {
    if (f.endsWith('.js')) {
      const input = require(path.join(inputsDir, f))
      loadedInputs[input.name] = input
    }
  }
}
```

Добавление нового `.js` файла в `inputs/` и перезапуск сервера — всё, что нужно для регистрации нового input-плагина.
