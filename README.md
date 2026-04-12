# BridgeTab

BridgeTab — це локальний browser bridge для Chrome: Chrome Extension + localhost bridge server, який дозволяє AI-асистенту програмно керувати відкритими вкладками, читати DOM, виконувати кліки та ввід, робити скріншоти, читати console/network помилки й отримувати структуровані JSON-відповіді.

Проєкт задуманий як універсальний інструмент, а не як автотест під один сайт. Він не хардкодить домени, селектори чи конкретний репозиторій і може перевикористовуватись у різних проєктах.

## Швидко: що це

- локальний bridge server на `127.0.0.1`
- Chrome Extension Manifest V3
- керування вкладками через єдиний JSON protocol
- allowlist доменів і session token
- popup UI українською для ручного `Підключити / Відключити`
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
5. Натиснути `Підключити поточну сесію`

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
- popup extension українською з feedback-блоком і health/status sync
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
- `scroll_into_view`
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
- `GET /capabilities`
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

## Швидка інтеграційна підказка

Щоб клієнт або AI-асистент міг швидко дізнатись, які команди доступні в поточній збірці, можна викликати:

```bash
curl http://127.0.0.1:17888/capabilities
```

У відповідь BridgeTab поверне список команд, required/optional args і базові feature flags.

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
- `focus`
- `type`
- `clear`
- `press_keys`
- `wait_for`
- `scroll_into_view`
- `hover`
- `select_option`
- `screenshot_page`
- `screenshot_element`
- `get_console_logs`
- `get_network_errors`
- `get_local_storage`
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
      "valueProperty": "",
      "valueAttribute": "",
      "visible": true,
      "enabled": true,
      "checked": false,
      "active": false,
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

`query` читає живий DOM-стан. Для form-елементів BridgeTab окремо повертає:

- `valueProperty` — поточне live-значення `element.value`
- `valueAttribute` — HTML-атрибут `value`, якщо він існує

Це особливо корисно для modern admin UI, де framework може тимчасово тримати старий attribute і новий live state окремо.

## Безпека

BridgeTab одразу закладає базові обмеження:

- сервер слухає тільки `127.0.0.1`
- extension підключається через session token
- token генерується локально
- доступ до сайтів обмежується allowlist-доменами
- користувач має вручну натиснути `Підключити поточну сесію`
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

## Що вже дороблено поверх MVP

Після поточного циклу допрацювань BridgeTab уже має:

- server-side валідацію команд і стабільніші error codes (`BAD_REQUEST`, `NO_ACTIVE_SESSION`, `COMMAND_TIMEOUT`)
- V2-команди `hover`, `select_option`, `get_local_storage`
- покращений popup із показом allowlist-статусу активного домену
- activity overlay у viewport під час роботи агента на сторінці
- плавніша прокрутка до елементів замість різкого стрибка viewport
- стабільніший input flow для WordPress admin / ACF / controlled inputs
- `reload` виконується як hard reload без використання cache
- richer logs/debug view в extension з `health`, `capabilities`, server audit logs і browser-side console/network logs
- quick actions у popup для `ping` і `get_page_state`

## Відомі поточні межі

Поточна версія вже суттєво ближча до “desktop product level”, але логічно розвивати далі:

- V2/V3-команди: `upload_file`, `evaluate_safe`, робота з cookies/session storage
- ще стабільніші complex interactions для нестандартних SPA/UI-кейсів
- інтеграційні автотести для реального extension flow і Chrome-взаємодії

## Чи обов’язковий `npm`

Так, у поточній версії `npm` є основним і очікуваним способом запуску `bridge-server`.

Це свідоме рішення для поточного етапу проєкту:

- менше складності в підтримці й дистрибуції
- швидший цикл розробки
- фокус на стабільності bridge, а не на пакуванні runner-а

Потенційні launcher/binary-варіанти можна розглядати пізніше, коли interaction layer і extension flow будуть повністю стабілізовані.

## Документація

Додаткові файли:

- [docs/setup.md](docs/setup.md)
- [docs/protocol.md](docs/protocol.md)
- [docs/security.md](docs/security.md)
- [examples/example-commands.json](examples/example-commands.json)

## Якість і перевірки

Server-side частина тепер має автоматизовані перевірки:

```bash
cd bridge-server
npm test
```

Або повний check:

```bash
cd bridge-server
npm run check
```

Покрито:

- command validation
- session manager flow
- screenshot routing
- logger clear behavior

## Наступний етап

Найближчі доробки, які залишаються для доведення BridgeTab:

1. Інтеграційні тести для повного extension/WebSocket/content-script flow, щоб стабільно ловити регресії в живому сценарії.
2. Команди наступного рівня: `upload_file`, безпечний `evaluate_safe`, а також читання `cookies` і `sessionStorage` в межах поточної моделі безпеки.
3. Підсилення interaction layer для складних SPA-сценаріїв: повторні спроби, кращий `wait_for`, стабільніша робота з dynamic DOM і асинхронними переходами.
4. Подальший розвиток diagnostics: чіткіший tab-scoped огляд, фільтрація подій, очищення стану і краща візуалізація browser/server-side проблем.
5. Розширення automated checks не лише для server-side протоколу, а й для ключових користувацьких маршрутів у самому розширенні.
