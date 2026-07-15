# Jenn — текущее состояние системы

## Структура проекта

```
D:\Coding\Jenn System\high_jenn\
├── .env                     # API ключи (GigaChat, Groq, OpenRouter, Notion и т.д.)
├── .gitignore
├── API.md                   # OpenAPI документация
├── IDEAS.md                 # Архитектура и планы (скиллы, destinations, автоклассификация)
├── SUMMARY.md               # Этот файл
├── package.json
├── index.js                 # Точка входа Express-сервера
├── config.js                # Загрузка jenn.config.json с подстановкой env-переменных
├── jenn.config.json         # Основной конфиг (провайдеры, связки skill→output)
├── routes.js                # Auth middleware + эндпоинты
├── store.js                 # In-memory хранилище (токены, сообщения, rate limiter)
├── client.js                # CLI клиент (node client.js)
│
├── ai/
│   ├── router.js            # AI Router — пробует провайдеров по порядку, fallback
│   ├── prompt.js            # Сборка system prompt из списка скиллов
│   └── providers/
│       ├── groq.js          # Groq SDK (llama-3.3-70b) + JSON mode
│       ├── openrouter.js    # OpenRouter API (gpt-4o-mini) + JSON mode
│       └── gigachat.js      # GigaChat SDK (через Sber API, самоподписанный сертификат)
│
├── core/
│   └── processor.js         # message → AI → skill → output + fallback
│
├── skills/
│   ├── create_note.js       # Создать заметку (параметры: title, content)
│   └── create_reminder.js   # Создать напоминание (параметры: text, datetime)
│
├── outputs/
│   └── notion.js            # Notion output (заглушка — только console.log)
│
└── examples/
    ├── DesktopInput/        # C# WinForms приложение
    │   ├── DesktopInput.csproj
    │   ├── Program.cs       # Alt+Space → поле ввода → Enter → POST /v1/message
    │   └── publish/
    │       ├── DesktopInput.exe   # 167 КБ, готовый .exe
    │       └── run.bat
    ├── tg-bot.js            # Telegram bot → POST /v1/message
    └── desktop-input.ahk    # AutoHotkey версия (Alt+Space)
```

## API эндпоинты

| Метод | Путь | Аутентификация | Описание |
|-------|------|---------------|----------|
| `POST` | `/v1/message` | Bearer token | Отправить сообщение (AI → skill → output) |
| `GET` | `/v1/ping` | Bearer token | Проверка соединения, возвращает `{ source }` |
| `GET` | `/health` | ❌ нет | Статус сервера (uptime, version) |

### Формат POST /v1/message

```json
{
  "source": "tg_bot",
  "text": "напомни купить молоко",
  "user": { "id": "123", "name": "Иван" },
  "meta": {}
}
```

### Тестовый токен

`test-token-550e8400` (источник: `test_bot`)

## AI Router

3 провайдера с последовательным fallback:

1. **Groq** — `llama-3.3-70b-versatile` + `response_format: json_object`
2. **OpenRouter** — `gpt-4o-mini` + `response_format: json_object`
3. **GigaChat** — `GigaChat` + `rejectUnauthorized: false`

Каждый возвращает `{"skill": "name", "params": {...}}` или `{"skill": null}`.  
Router извлекает JSON из ответа через regex (даже если обёрнут в markdown).

## Полная цепочка обработки

```
POST /v1/message
  → auth (проверка Bearer token)
  → валидация (source, text, user.id, rate limit)
  → store.addMessage() (сохранить в памяти)
  → processor.process()
      → AI Router (провайдеры по порядку)
          → prompt: список скиллов → JSON с намерением
      → skill.handler(params)
      → output.send(result)
  → 201 { message_id, result }
```

## Конфигурация

### `.env` — секреты

```env
GROQ_KEY=gsk_...
OPENROUTER_KEY=sk-or-...
GIGACHAT_KEY=<base64 auth key>
NOTION_API_KEY=ntn_...
GSHEETS_PRIVATE_KEY=...
TG_BOT_TOKEN=...
```

### `jenn.config.json` — структура

```json
{
  "ai": {
    "providers": [
      { "name": "groq", "key": "${GROQ_KEY}", "model": "llama-3.3-70b-versatile" },
      { "name": "openrouter", "key": "${OPENROUTER_KEY}", "model": "gpt-4o-mini" },
      { "name": "gigachat", "key": "${GIGACHAT_KEY}", "model": "GigaChat" }
    ]
  },
  "skillsOutputs": {
    "create_note": "notion",
    "create_reminder": "google_sheets"
  },
  "fallbackOutput": "telegram",
  "outputs": {
    "notion": { "api_key": "${NOTION_API_KEY}", "database_id": "${NOTION_DATABASE_ID}" }
  }
}
```

## Как запустить

```bash
# Сервер
node index.js
# → http://localhost:3000
# → авто-загрузка skills/, outputs/, jenn.config.json

# Клиент (CLI)
node client.js
# → ввод текста → Enter → отправка на сервер

# Telegram bot
BOT_TOKEN=xxx node examples/tg-bot.js

# Desktop input (Alt+Space)
examples/DesktopInput/publish/DesktopInput.exe
```

## Что уже работает

- [x] Express сервер на `0.0.0.0:3000`
- [x] API: POST /v1/message, GET /v1/ping, GET /health
- [x] Bearer token аутентификация
- [x] Rate limiter (60 запросов/мин)
- [x] Валидация (поля, длина текста)
- [x] AI Router с 3 провайдерами (Groq, OpenRouter, Gigachat)
- [x] JSON-режим у провайдеров
- [x] Fallback при ошибках AI
- [x] Загрузка навыков из папки `skills/`
- [x] Загрузка выводов из папки `outputs/`
- [x] `jenn.config.json` с подстановкой `${VAR}` из `.env`
- [x] CLI клиент
- [x] Telegram bot пример
- [x] Desktop input (C# WinForms, Alt+Space)
- [x] AI определяет намерение → вызывает skill → отправляет в output

## Что в плане (см. IDEAS.md)

- [ ] Универсальный скилл `save_entry` с вложенной AI-классификацией
- [ ] Category AI (второй вызов AI для определения категории)
- [ ] Destinations (привязка категорий → базы данных)
- [ ] Буфер для неклассифицированных записей
- [ ] Notion output: список баз данных, создание страницы
- [ ] Google Sheets output: добавление строки
- [ ] Веб-интерфейс для настройки
- [ ] Автоклассификация с обучением
