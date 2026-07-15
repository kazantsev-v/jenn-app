# Jenn HTTP API v1

**Базовый URL:** `https://api.jenn.dev/v1`
**Формат:** JSON
**Авторизация:** `Authorization: Bearer <token>` (во всех запросах, кроме `/health`)

---

## Аутентификация

Разработчик получает токен при регистрации. Токен — UUID v4.

```
Header: Authorization: Bearer 550e8400-e29b-41d4-a716-446655440000
```

Без токена — `401 Unauthorized`.

---

## Эндпоинты

### 1. Проверка соединения

Проверяет, что токен валиден и input настроен правильно.

```
GET /v1/ping
```

**Ответ: `200 OK`**

```json
{
  "status": "ok",
  "source": "tg_bot"
}
```

**Ошибки:**

| Код | Описание             |
|-----|----------------------|
| 401 | Невалидный токен     |

---

### 2. Отправить сообщение

```
POST /v1/message
```

**Тело запроса:**

| Поле      | Тип    | Обязательно | Описание                              |
|-----------|--------|-------------|---------------------------------------|
| `source`  | string | да          | Уникальное имя источника (`tg_bot`)   |
| `text`    | string | да          | Текст сообщения                       |
| `user.id` | string | да          | ID пользователя в системе источника   |
| `user.name` | string | нет       | Отображаемое имя пользователя         |
| `meta`    | object | нет         | Любые доп. данные от источника        |

**Пример:**

```json
{
  "source": "tg_bot",
  "text": "Привет, Jenn!",
  "user": {
    "id": "123456789",
    "name": "Иван Петров"
  },
  "meta": {
    "chat_id": -1001234567890,
    "message_type": "private"
  }
}
```

**Ответ: `201 Created`**

```json
{
  "status": "ok",
  "message_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "received_at": "2026-07-07T12:00:00Z"
}
```

**Ошибки:**

| Код | Описание                                    |
|-----|---------------------------------------------|
| 400 | Нет `source` или `text`, или `user.id`      |
| 401 | Невалидный токен                            |
| 413 | Текст больше 4096 символов                  |
| 429 | Слишком много запросов (rate limit)         |

---

### 3. Статус сервера

```
GET /health
```

Токен не требуется.

**Ответ: `200 OK`**

```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "1.0.0"
}
```

---

## Rate Limits

| Лимит                           | Значение     |
|---------------------------------|--------------|
| Сообщений в минуту              | 60           |
| Размер `text`                   | до 4096 симв |
| Размер всего тела               | до 64 КБ     |

При превышении — `429 Too Many Requests` с заголовком `Retry-After`.

---

## Коды ошибок

```json
{
  "error": "invalid_token",
  "message": "Token not found or expired"
}
```

| Ошибка              | HTTP код | Описание                    |
|---------------------|----------|-----------------------------|
| `invalid_token`     | 401      | Токен не найден             |
| `missing_fields`    | 400      | Не хватает полей            |
| `text_too_long`     | 413      | Текст превышает лимит       |
| `rate_limited`      | 429      | Превышен лимит запросов     |

---

## Примеры использования

### cURL

```bash
curl -X POST https://api.jenn.dev/v1/message \
  -H "Authorization: Bearer 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "tg_bot",
    "text": "Привет",
    "user": { "id": "123", "name": "Иван" }
  }'
```

### fetch (Node.js)

```js
const res = await fetch('https://api.jenn.dev/v1/message', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer 550e8400-...',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    source: 'tg_bot',
    text: 'Привет',
    user: { id: '123', name: 'Иван' }
  })
})
```
