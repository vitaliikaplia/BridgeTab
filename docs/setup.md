# Налаштування BridgeTab

## 1. Запустіть локальний bridge server

```bash
cd bridge-server
npm install
npm start
```

Під час першого запуску BridgeTab створює `~/.bridgetab/config.json` з такими полями:

- `host`: завжди `127.0.0.1`
- `port`: стандартно `17888`
- `token`: генерується локально
- `screenshotDir`: локальна директорія для PNG-скріншотів
- `logPath`: шлях до локального audit log

Скопіюйте токен із термінала або з конфіг-файлу.

## 2. Встановіть Chrome extension

1. Відкрийте `chrome://extensions`
2. Увімкніть `Developer Mode`
3. Натисніть `Load unpacked`
4. Виберіть директорію `extension/`

## 3. Підключіть браузерну сесію

1. Відкрийте popup BridgeTab
2. Вставте WebSocket URL bridge, зазвичай `ws://127.0.0.1:17888/ws`
3. Вставте session token із `~/.bridgetab/config.json`
4. Перевірте allowlist доменів
5. Натисніть `Connect current session`

Popup є явним кроком підтвердження від користувача для активації браузерної сесії.

## 4. Викликайте localhost API

Приклади:

```bash
curl http://127.0.0.1:17888/health
```

```bash
curl http://127.0.0.1:17888/capabilities
```

```bash
curl -H "X-Bridge-Token: YOUR_TOKEN" http://127.0.0.1:17888/tabs
```

```bash
curl -X POST http://127.0.0.1:17888/command \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "command": "list_tabs"
  }'
```

## 5. Переглядайте логи та діагностику

BridgeTab також має окрему diagnostics-сторінку в extension:

1. Відкрийте popup
2. Натисніть `Відкрити логи`
3. Перегляньте:
   - локальне сховище extension
   - browser-side console і network logs для активної вкладки
   - відповідь `/health` від bridge server
   - відповідь `/capabilities` від bridge server
   - записи `/logs` із сервера, якщо токен збережений
