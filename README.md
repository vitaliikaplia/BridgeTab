# BridgeTab

BridgeTab — це локальний browser bridge для Chrome: Chrome Extension + localhost bridge server, який дозволяє AI-асистенту програмно керувати відкритими вкладками, читати DOM, виконувати кліки та ввід, робити скріншоти, читати console/network помилки й отримувати структуровані JSON-відповіді.

Проєкт задуманий як універсальний інструмент, а не як автотест під один сайт. Він не хардкодить домени, селектори чи конкретний репозиторій і може перевикористовуватись у різних проєктах.

## Швидко: що це

- локальний bridge server на `127.0.0.1`
- Chrome Extension Manifest V3
- керування вкладками через єдиний JSON protocol
- allowlist доменів і session token
- popup UI для ручного `Connect / Disconnect`
- screenshots, DOM query, click/type/wait, console logs, network errors

## Швидко: як встановити

### 1. Запустити bridge server

```bash
cd bridge-server
npm install
npm start
```

Після старту сервер покаже:

- `HTTP: http://127.0.0.1:17888`
- `WebSocket: ws://127.0.0.1:17888/ws`
- `Token: ...`

Також конфіг автоматично збережеться в:

```bash
~/.bridgetab/config.json
```

### 2. Встановити Chrome Extension

1. Відкрити `chrome://extensions`
2. Увімкнути `Developer mode`
3. Натиснути `Load unpacked`
4. Вибрати папку:

```bash
./extension
```

### 3. Підключити поточну browser session

1. Відкрити popup BridgeTab
2. Вставити WebSocket URL:

```text
ws://127.0.0.1:17888/ws
```

3. Вставити token із термінала або `~/.bridgetab/config.json`
4. Перевірити allowlist доменів
5. Натиснути `Connect current session`

## Швидко: як користуватись

### Перевірити, що сервер живий

```bash
curl http://127.0.0.1:17888/health
```

### Отримати список вкладок

```bash
curl -H "X-Bridge-Token: YOUR_TOKEN" http://127.0.0.1:17888/tabs
```

### Отримати стан активної сторінки

```bash
curl -X POST http://127.0.0.1:17888/command \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "command": "get_page_state"
  }'
```

### Знайти елемент

```bash
curl -X POST http://127.0.0.1:17888/command \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "tabId": 123,
    "command": "query",
    "args": {
      "selector": "button",
      "all": true
    }
  }'
```

### Клікнути елемент

```bash
curl -X POST http://127.0.0.1:17888/command \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "tabId": 123,
    "command": "click",
    "args": {
      "selector": "[data-testid=\"submit\"]"
    }
  }'
```

### Зробити screenshot поточної вкладки

```bash
curl -X POST http://127.0.0.1:17888/command \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "tabId": 123,
    "command": "screenshot_page"
  }'
```

Bridge збереже PNG у локальну директорію та поверне `path`.

---

## Що ми вже реалізували

У проєкті вже є робочий MVP, який пройшов живу перевірку в Chrome:

- локальний `bridge-server` на Node.js
- HTTP API + WebSocket transport
- session token
- `localhost only` bind на `127.0.0.1`
- popup extension з ручним connect flow
- allowlist доменів
- audit log
- screenshots у temp-like local folder
- DOM helper layer у content script
- збір `console.error`, `console.warn`, `window.onerror`, `unhandledrejection`
- збір network failures і HTTP `4xx/5xx`

Практично перевірено:

- `get_page_state`
- `list_tabs`
- `query`
- `click`
- `get_console_logs`
- `get_network_errors`
- `screenshot_page`

## Архітектура

BridgeTab складається з 3 частин:

### 1. Chrome Extension

Відповідає за:

- інжекцію content script у сторінку
- читання DOM
- виконання дій над елементами
- збір browser-side логів
- popup UI для ручного керування сесією

Основні файли:

- `extension/manifest.json`
- `extension/background.js`
- `extension/content.js`
- `extension/popup.html`
- `extension/popup.js`
- `extension/storage.js`

### 2. Background service worker

Відповідає за:

- керування вкладками
- зв’язок із localhost bridge через WebSocket
- screenshots через Chrome Tabs API
- прокидування команд до content script
- повернення structured response

### 3. Local bridge server

Відповідає за:

- запуск локального HTTP API
- запуск WebSocket endpoint для extension
- валідацію token
- audit logging
- збереження screenshots
- request/response routing

Основні файли:

- `bridge-server/src/server.js`
- `bridge-server/src/session-manager.js`
- `bridge-server/src/command-router.js`
- `bridge-server/src/logger.js`
- `bridge-server/src/screenshot-store.js`

## Структура проєкту

```text
BridgeTab/
  extension/
  bridge-server/
  docs/
  examples/
  README.md
```

## HTTP API

Поточні ендпоінти:

- `GET /health`
- `GET /tabs`
- `GET /logs`
- `POST /connect`
- `POST /disconnect`
- `POST /command`

## JSON protocol

Базовий формат команди:

```json
{
  "token": "secret-session-token",
  "tabId": 123,
  "command": "click",
  "args": {
    "selector": "[data-testid='submit']"
  },
  "timeoutMs": 10000
}
```

Базовий формат відповіді:

```json
{
  "success": true,
  "command": "click",
  "tabId": 123,
  "result": {
    "clicked": true
  },
  "error": null
}
```

## Підтримувані MVP-команди

- `ping`
- `list_tabs`
- `activate_tab`
- `navigate`
- `get_page_state`
- `query`
- `click`
- `type`
- `press_keys`
- `wait_for`
- `scroll_into_view`
- `screenshot_page`
- `screenshot_element`
- `get_console_logs`
- `get_network_errors`
- `reload`

## Приклад `query`

```json
{
  "success": true,
  "command": "query",
  "tabId": 123,
  "result": {
    "exists": true,
    "count": 1,
    "first": {
      "tag": "button",
      "text": "Save",
      "html": "<button type=\"submit\">Save</button>",
      "value": "",
      "visible": true,
      "enabled": true,
      "checked": false,
      "rect": {
        "x": 12,
        "y": 44,
        "width": 120,
        "height": 36
      },
      "attributes": {
        "type": "submit"
      }
    }
  },
  "error": null
}
```

## Безпека

BridgeTab одразу закладає базові обмеження:

- сервер слухає тільки `127.0.0.1`
- extension підключається через session token
- token генерується локально
- доступ до сайтів обмежується allowlist-доменами
- користувач має вручну натиснути `Connect current session`
- arbitrary JS execution у першій версії не реалізовано
- audit log не зберігає чутливі поля типу паролів

## Де лежить конфіг

BridgeTab автоматично створює:

```bash
~/.bridgetab/config.json
```

Типовий вміст:

```json
{
  "host": "127.0.0.1",
  "port": 17888,
  "token": "generated-locally",
  "screenshotDir": "/Users/you/.bridgetab/screenshots",
  "logPath": "/Users/you/.bridgetab/audit.log",
  "debugMode": false
}
```

## Логи та screenshots

Локальні артефакти зберігаються тут:

- screenshots: `~/.bridgetab/screenshots`
- audit log: `~/.bridgetab/audit.log`

## Відомі поточні межі

Поточна версія вже робоча, але ще не “desktop product level”. З того, що логічно розвивати далі:

- health-sync UX у popup
- кращий error feedback без `alert`
- desktop runner або standalone binary без user-facing `npm install`
- V2-команди: `hover`, `select_option`, `upload_file`, `evaluate_safe`, `get_local_storage`
- більш зручний logs viewer усередині extension

## Чи обов’язковий `npm`

Ні. У поточній версії `npm` використовується як dev/runtime спосіб запуску bridge-server.

Для користувацького UX можна зробити:

- готовий standalone runner
- `start-bridge.command` для macOS
- `start-bridge.bat` для Windows
- або повністю запакований binary без вимоги ставити `npm`

## Документація

Додаткові файли:

- `docs/setup.md`
- `docs/protocol.md`
- `docs/security.md`
- `examples/example-commands.json`

## Наступні рекомендовані кроки

Щоб довести BridgeTab до рівня “аналог browser control layer як у Claude Code, але сильніше і зручніше”, я б робив далі так:

1. Прибрати `npm` із user flow через standalone runner
2. Доробити popup до повноцінного control center
3. Додати richer logs/debug panel
4. Додати V2-команди
5. Продумати безпечний `debug mode` з обмеженим `evaluate_safe`
