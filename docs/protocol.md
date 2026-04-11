# Протокол BridgeTab

Усі команди використовують один і той самий JSON envelope через `POST /command`.

Можливості bridge також можна перевірити через `GET /capabilities`.

## Запит

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

## Відповідь

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

## MVP-команди

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

## Примітки до команд

### `navigate`

Аргументи:

```json
{
  "url": "https://example.test",
  "createNew": true
}
```

### `query`

Аргументи:

```json
{
  "selector": "button.primary",
  "all": true
}
```

Типовий результат для form-елемента:

```json
{
  "exists": true,
  "count": 1,
  "first": {
    "tag": "input",
    "value": "UA flex",
    "valueProperty": "UA flex",
    "valueAttribute": "UA flex",
    "visible": true,
    "enabled": true,
    "active": false
  }
}
```

`valueProperty` показує живе значення `element.value`, а `valueAttribute` — HTML-атрибут `value`. Для dynamic admin UI і controlled input-ів це два різні діагностичні сигнали.

### `hover`

Аргументи:

```json
{
  "selector": "[data-menu='account']"
}
```

### `select_option`

Аргументи:

```json
{
  "selector": "select[name='country']",
  "value": "ua"
}
```

Можна використовувати `value`, `label` або `index`.

### `focus`

Аргументи:

```json
{
  "selector": "input[name='email']"
}
```

### `clear`

Аргументи:

```json
{
  "selector": "input[name='email']"
}
```

Типовий результат:

```json
{
  "success": true,
  "committed": true,
  "value": "",
  "debug": {
    "strategy": "blur_commit",
    "before": {
      "valueProperty": "EN flex",
      "valueAttribute": "EN flex"
    },
    "after": {
      "valueProperty": "",
      "valueAttribute": "EN flex",
      "committed": true,
      "elapsedMs": 412
    },
    "events": [
      "beforeinput",
      "input",
      "change",
      "keydown",
      "keypress",
      "keyup",
      "blur",
      "focusout"
    ]
  }
}
```

`clear` повертає:

- `success: true` — команда виконалась технічно коректно
- `committed` — чи новий стан реально втримався в live DOM
- `debug` — діагностика для складних форм, зокрема ACF/Gutenberg

### `type`

Аргументи:

```json
{
  "selector": "input[name='email']",
  "text": "hello@example.com",
  "clearFirst": true
}
```

Типовий результат:

```json
{
  "success": true,
  "committed": true,
  "requestedValue": "hello@example.com",
  "value": "hello@example.com",
  "debug": {
    "strategy": "direct_input",
    "before": {
      "valueProperty": "",
      "valueAttribute": null
    },
    "after": {
      "valueProperty": "hello@example.com",
      "valueAttribute": null,
      "activeElementTag": "input",
      "activeMatchesTarget": true,
      "committed": true,
      "elapsedMs": 268
    },
    "events": [
      "beforeinput",
      "input",
      "change",
      "keydown",
      "keypress",
      "keyup",
      "blur",
      "focusout"
    ]
  },
  "error": null
}
```

BridgeTab для `type` і `clear` окремо перевіряє, чи нове значення справді закомітилось у live DOM. Це зроблено спеціально для WordPress admin, ACF, Gutenberg і інших controlled form UI.

### `get_page_state`

Повертає:

```json
{
  "url": "https://example.test/profile",
  "title": "Profile",
  "readyState": "complete",
  "viewport": {
    "width": 1440,
    "height": 900,
    "devicePixelRatio": 2
  },
  "scroll": {
    "x": 0,
    "y": 320
  },
  "theme": "light"
}
```

### `get_console_logs`

Повертає буферизований масив подій `console.error`, `console.warn`, `window.onerror` і `unhandledrejection`:

```json
[
  {
    "level": "error",
    "message": "Unhandled promise rejection",
    "timestamp": "2026-04-11T00:00:00.000Z",
    "source": "unhandledrejection"
  }
]
```

### `get_network_errors`

Повертає невдалі запити і HTTP-відповіді `4xx/5xx`, які зафіксувало extension:

```json
[
  {
    "url": "https://example.test/api/profile",
    "method": "GET",
    "status": 500,
    "type": "http_error",
    "timestamp": "2026-04-11T00:00:00.000Z"
  }
]
```

### `get_local_storage`

Повертає повний snapshot `localStorage` для поточного origin або лише запитані ключі:

```json
{
  "origin": "https://example.test",
  "count": 2,
  "storage": {
    "token": "abc",
    "theme": "dark"
  }
}
```

### `scroll_into_view`

BridgeTab прокручує сторінку плавно й після цього чекає коротку stabilization-паузу, щоб наступна команда працювала вже по оновленому viewport.

### `screenshot_page`

Повертає шлях до PNG, створеного bridge server:

```json
{
  "path": "/Users/you/.bridgetab/screenshots/screenshot-page-1712800000000.png"
}
```

## Помилки

BridgeTab повертає компактні структуровані помилки, наприклад:

```json
{
  "code": "COMMAND_FAILED",
  "message": "Element not found"
}
```

Типові коди на рівні протоколу:

- `BAD_REQUEST`
- `UNAUTHORIZED`
- `NO_ACTIVE_SESSION`
- `COMMAND_TIMEOUT`
- `COMMAND_FAILED`
