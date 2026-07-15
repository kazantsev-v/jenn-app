# Jenn — AI-ассистент для обработки и маршрутизации сообщений

Jenn принимает входящие сообщения из разных источников (Telegram, CLI, десктоп), пропускает через AI-роутер, исполняет навыки (skills) и сохраняет результат в базы знаний (Notion и др.).

---

## Быстрый старт

```bash
# 1. Установка зависимостей
npm install

# 2. Настройка окружения
copy .env.example .env
# Отредактируйте .env — впишите свои API-ключи

# 3. Запуск сервера
node index.js
# → Лендинг: http://localhost:3000/
# → Console: http://localhost:3000/console
# → Legacy Admin: http://localhost:3000/app
```

---

## Архитектура

```
Источник (tg_bot / CLI / desktop) → POST /v1/message
    ↓
  Processor (core/processor.js)
    ├── AI Router (ai/router.js) — определяет намерение и категорию
    ├── Skill (skills/*.js) — исполняет логику (save_entry, create_reminder)
    └── Output (outputs/*.js) — сохраняет в Notion и т.д.
    ↓
  Ответ: { status, result }
```

**Поток данных:**
1. Внешний источник отправляет POST `/v1/message` с Bearer-токеном
2. `Processor` проверяет rate-limit (60/мин на источник), сохраняет сообщение
3. **AI Router** обходит провайдеров по порядку (Groq → OpenRouter → GigaChat), пока один не ответит
4. Определяется **навык** (skill) и **категория**
5. Skill исполняется с данными из сообщения
6. Результат отправляется в **output** (Notion и т.д.)

---

## Админ-панель

### Console (`/console`)
Новая админ-панель в Stitch-стиле (Tailwind CSS, тёмная тема, glass-morphism).

- **Dashboard** — обзор системы: inputs, outputs, skills, messages, лента активности
- **Pipeline** — визуальный пайплайн: источники → Jenn Core → выходы. Настройка через модалки.
- **Activity** — история сообщений.
- **Logs** — real-time логи обработки через SSE.
- **API Keys** — управление source tokens.
- **Settings** — конфигурация пользователя (JSON editor).
- **Dev Test** — тестовые сообщения (скрыт, активируется 10 кликами на Settings).

### Legacy Admin (`/app`)
Одностраничное приложение (vanilla JS, тёмная тема). Routes, Messages, Logs, Test.

Для входа: зарегистрируйтесь или используйте существующего пользователя.

---

## Переменные окружения (.env)

| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `GROQ_KEY`         | API-ключ Groq                     |
| `OPENROUTER_KEY`   | API-ключ OpenRouter               |
| `GIGACHAT_KEY`     | Base64-ключ GigaChat              |
| `GIGACHAT_CLIENT_ID` | Client ID GigaChat               |
| `GIGACHAT_SCOPE`   | Scope GigaChat                    |
| `NOTION_API_KEY`   | Internal Integration Secret Notion |
| `JWT_SECRET`       | Секрет подписи JWT (сменить в production!) |
| `PORT`             | Порт сервера (по умолч. 3000)     |
| `TG_BOT_TOKEN`     | Токен Telegram-бота               |
| `TG_CHAT_ID`       | ID чата Telegram                  |

---

## API endpoints

### Публичные

| Метод | Путь            | Описание                         |
|-------|-----------------|----------------------------------|
| POST  | `/v1/message`   | Отправить сообщение (Bearer-токен)|
| GET   | `/v1/ping`      | Проверка соединения              |
| GET   | `/health`       | Health-check                     |

### Admin (`/v1/admin`)

| Метод | Путь                              | Описание                    |
|-------|-----------------------------------|-----------------------------|
| POST  | `/register`                       | Регистрация                 |
| POST  | `/login`                          | Вход                        |
| POST  | `/logout`                         | Выход                       |
| GET   | `/token`                          | Refresh JWT по cookie       |
| GET   | `/config`                         | Конфигурация пользователя   |
| PUT   | `/config`                         | Сохранить конфигурацию      |
| GET   | `/inputs`                         | Установленные источники     |
| GET   | `/skills`                         | Установленные навыки        |
| GET   | `/outputs`                        | Установленные выходы        |
| POST  | `/outputs/notion/test`            | Проверить ключ Notion       |
| POST  | `/test-message`                   | Тестовое сообщение          |
| GET   | `/logs/recent`                    | Последние логи              |
| GET   | `/logs/stream`                    | SSE-поток логов             |

Полная документация — в `API.md`.

Контракт для разработки новых output-плагинов — в `OUTPUTS.md`.

---

## Примеры

- `node client.js` — CLI-клиент: ввод текста → отправка на сервер
- `node examples/tg-bot.js` — Telegram-бот как входной источник
- `examples/desktop-input.ahk` — AutoHotkey: выделить текст + горячая клавиша → отправка
- `examples/DesktopInput/` — C# WinForms: Alt+Space → окно ввода → отправка

---

## Структура проекта

```
├── index.js              # Точка входа (Express-сервер)
├── config.js             # Загрузка конфигов (глобальный + на пользователя)
├── auth.js               # JWT + bcrypt
├── store.js              # In-memory store с персистентностью
├── routes.js             # Публичные API-роуты
├── routes-admin.js       # Admin API-роуты
├── ai/                   # AI-роутер и провайдеры
│   ├── router.js
│   ├── prompt.js
│   └── providers/        # groq, openrouter, gigachat
├── core/
│   └── processor.js      # Основной процессор сообщений
├── skills/               # Навыки (save_entry, create_reminder)
├── outputs/              # Выходы (notion)
├── public/               # Admin SPA (index.html)
├── data/                 # Пользователи, конфиги, реестры
└── examples/             # Примеры интеграций
```

---

## Примечания

- Сервер Node.js 22+ (использует встроенный `fetch`).
- Для Notion используется `https.request` (не `undici`) для совместимости с корпоративными сетями.
- Admin panel использует httpOnly cookie + Bearer-токен для авторизации.
- Все конфиги пользователей хранятся в `data/configs/{username}.json` с подстановкой `${VAR}` из `.env`.
