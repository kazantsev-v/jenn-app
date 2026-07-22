# Jenn — AI-ассистент для обработки и маршрутизации сообщений

Jenn принимает входящие сообщения из разных источников (Telegram, CLI, десктоп), пропускает через AI-роутер, исполняет навыки (skills) и сохраняет результат в базы знаний (Notion и др.).

---

## Быстрый старт

```bash
# 1. Установка зависимостей
npm install

# 2. Настройка окружения
cp .env.example .env
# Отредактируйте .env — впишите свои API-ключи

# 3. Инициализация БД
npx prisma migrate dev

# 4. Запуск сервера
node index.js
# → Лендинг: http://localhost:3000/
# → Console: http://localhost:3000/console
# → Legacy Admin: http://localhost:3000/app
```

---

## Управление в production

### Локальный запуск (один процесс)

```bash
npm start
# Запускает index.js — Express сервер + Telegram-бот в одном процессе
# HTTP на localhost:3000
```

### Production запуск (HTTPS + Let's Encrypt)

```bash
# Первый запуск — спросит домен и email для сертификата
npm run start:prod

# Последующие запуски — читает конфигурацию из .env.production
npm run start:prod
```

При первом запуске скрипт:
1. Спросит домен (например, `example.com`) и email для Let's Encrypt
2. Установит certbot если его нет
3. Получит SSL сертификат
4. Сохранит конфигурацию в `.env.production`
5. Запустит core (HTTPS на 443) и bot (Telegram) как отдельные процессы

### Раздельный запуск в production

```bash
# Только core с HTTPS (Express сервер)
npm run start:prod:core

# Только Telegram-бот (в другом терминале / tmux)
npm run start:prod:bot
```

Полезно для отладки или когда нужно перезапустить только один компонент.

### Раздельный запуск локально

```bash
# Только Express сервер (без Telegram-бота)
npm run start:core

# Только Telegram-бот (ожидает core на localhost:3000)
npm run start:bot
```

### Автозагрузка через systemd

```bash
# Создать systemd сервисы и включить автозагрузку
sudo npm run setup:autostart

# Или вручную:
sudo bash setup-autostart.sh /path/to/jenn-app
```

Скрипт создаёт два независимых сервиса:
- `jenn-core.service` — Express сервер
- `jenn-bot.service` — Telegram-бот (зависит от core)

Оба сервиса автоматически перезапускаются при падении (`Restart=always`).

Можно запускать/останавливать их независимо:

```bash
# Запустить только core
sudo systemctl start jenn-core

# Запустить только bot
sudo systemctl start jenn-bot

# Остановить только core (bot тоже остановится из-за зависимости)
sudo systemctl stop jenn-core

# Остановить только bot
sudo systemctl stop jenn-bot
```

### Управление сервисами

```bash
# Статус
systemctl status jenn-core jenn-bot

# Остановка
systemctl stop jenn-core jenn-bot

# Запуск
systemctl start jenn-core jenn-bot

# Перезапуск
systemctl restart jenn-core jenn-bot

# Логи в реальном времени
journalctl -u jenn-core -u jenn-bot -f

# Логи за последний час
journalctl -u jenn-core -u jenn-bot --since "1 hour ago"
```

### Обновление кода

```bash
# Остановить сервисы
sudo systemctl stop jenn-core jenn-bot

# Обновить код
git pull origin main
npm install --production

# Применить миграции БД и перегенерировать Prisma Client
npx prisma migrate deploy
npx prisma generate

# Запустить сервисы
sudo systemctl start jenn-core jenn-bot
```

### Ручное обновление SSL сертификата

```bash
# Certbot автоматически обновляет сертификаты через cron/systemd timer.
# Принудительное обновление:
sudo certbot renew

# После обновления перезапустить core:
sudo systemctl restart jenn-core
```

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Inputs                                │
│  browser_extension  │  desktop  │  tg_bot  │  CLI / other   │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    POST /v1/message
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Jenn Core (jenn-core.js)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  AI Router   │→ │    Skills    │→ │   Outputs    │      │
│  │ (ai/router)  │  │ (skills/*)   │  │ (outputs/*)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Telegram Bridge (jenn-bot.js)                   │
│  Polling → fetch /v1/message → response to user             │
└─────────────────────────────────────────────────────────────┘
```

**Поток данных:**
1. Внешний источник отправляет POST `/v1/message` с Bearer-токеном
2. `Processor` проверяет rate-limit (60/мин на источник), сохраняет сообщение
3. **AI Router** обходит провайдеров по порядку (Groq → OpenRouter → GigaChat), пока один не ответит
4. Определяется **навык** (skill) и **категория**
5. Skill исполняется с данными из сообщения
6. Результат отправляется в **output** (Notion, Obsidian и т.д.)

**Telegram-бот работает независимо:**
- Если core недоступен — бот отвечает заготовкой ("система временно недоступна")
- Проверка доступности core перед каждым сообщением через `/health`

---

## Источники (Inputs)

| Источник | Описание |
|----------|----------|
| `browser_extension` | Chrome-расширение для отправки выделенного текста |
| `desktop` | Desktop Input — Alt+Space → окно ввода → отправка |
| `tg_bot` | Telegram-бот (встроенный или отдельный) |

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

### AI Providers
| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `GROQ_KEY`         | API-ключ Groq                     |
| `OPENROUTER_KEY`   | API-ключ OpenRouter               |
| `GIGACHAT_KEY`     | Base64-ключ GigaChat              |
| `GIGACHAT_CLIENT_ID` | Client ID GigaChat               |
| `GIGACHAT_SCOPE`   | Scope GigaChat                    |

### Интеграции
| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `NOTION_API_KEY`   | Internal Integration Secret Notion |
| `GSHEETS_CLIENT_EMAIL` | Google Sheets service account email |
| `GSHEETS_PRIVATE_KEY`  | Google Sheets private key         |
| `GSHEETS_SHEET_ID`     | Google Sheets spreadsheet ID      |

### Telegram
| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `BOT_TOKEN`        | Токен Telegram-бота (основной)    |
| `TG_BOT_TOKEN`     | Токен Telegram-бота (bridge)      |
| `TG_CHAT_ID`       | ID чата Telegram                  |

### Сервер и БД
| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `PORT`             | Порт сервера (по умолч. 3000)     |
| `JWT_SECRET`       | Секрет подписи JWT (сменить в production!) |
| `DATABASE_URL`     | Строка подключения к БД           |
| `JENN_DB_LOG`      | Уровень логирования БД (0=off)    |

### Production (HTTPS)
| Переменная         | Описание                          |
|--------------------|-----------------------------------|
| `DOMAIN`           | Домен для SSL (создаётся автоматически) |
| `SITE_URL`         | Канонический публичный URL для SEO, например `https://jenn.example` |
| `SSL_KEY`          | Путь к приватному ключу (создаётся автоматически) |
| `SSL_CERT`         | Путь к сертификату (создаётся автоматически) |

---

## API endpoints

### Публичные

| Метод | Путь            | Описание                         |
|-------|-----------------|----------------------------------|
| POST  | `/v1/message`   | Отправить сообщение (Bearer-токен)|
| POST  | `/v1/subscribe` | Подписка на обновления (email)   |
| GET   | `/v1/ping`      | Проверка соединения              |
| GET   | `/health`       | Health-check                     |
| GET   | `/robots.txt`   | Правила индексации для поисковых роботов |
| GET   | `/sitemap.xml` | Динамическая карта публичных страниц |

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
├── index.js              # Точка входа (Express-сервер + Telegram-бот)
├── jenn-core.js          # Production: Express сервер (без Telegram)
├── jenn-bot.js           # Production: Telegram-бот (отдельный процесс)
├── start.sh              # Production launcher с Let's Encrypt
├── setup-autostart.sh    # Настройка systemd автозагрузки
├── config.js             # Загрузка конфигов (глобальный + на пользователя)
├── db.js                 # Подключение к БД (Prisma)
├── auth.js               # JWT + bcrypt
├── store.js              # In-memory store с персистентностью
├── routes.js             # Публичные API-роуты
├── routes-admin.js       # Admin API-роуты
├── services/
│   └── telegram-bridge.js # Telegram-бот как отдельный сервис
├── ai/                   # AI-роутер и провайдеры
│   ├── router.js
│   ├── prompt.js
│   └── providers/        # groq, openrouter, gigachat
├── core/
│   └── processor.js      # Основной процессор сообщений
├── inputs/               # Источники
│   ├── browser_extension.js
│   ├── desktop.js
│   └── tg_bot.js
├── skills/               # Навыки
│   └── save_entry.js
├── outputs/              # Выходы
│   ├── notion.js
│   └── jenn-output-obsidian.js
├── prisma/               # Схема БД и миграции
│   └── schema.prisma
├── public/               # Frontend (лендинги, консоль, FAQ, docs)
│   ├── index.html        # Главная (лендинг)
│   ├── console.html      # Консоль управления
│   ├── app.html          # Legacy Admin
│   ├── faq.html          # FAQ
│   ├── docs.html         # Документация API
│   └── stitch/           # Дополнительные лендинги
├── data/                 # Пользователи, конфиги, реестры
└── examples/             # Примеры интеграций
```

---

## Примечания

- Сервер Node.js 22+ (использует встроенный `fetch`).
- Для Notion используется `https.request` (не `undici`) для совместимости с корпоративными сетями.
- Admin panel использует httpOnly cookie + Bearer-токен для авторизации.
- Конфигурации пользователей хранятся в БД (таблица `UserConfig`) с подстановкой `${VAR}` из `.env`.
- База данных: SQLite для разработки, PostgreSQL для production.
- Telegram-бот работает независимо от core — если core недоступен, отвечает заготовкой.
