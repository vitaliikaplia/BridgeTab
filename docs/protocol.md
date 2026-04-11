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
  "exists": true,
  "count": 1,
  "first": {
    "tag": "button",
    "text": "Save",
    "html": "<button class=\"primary\">Save</button>",
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
      "class": "primary"
    }
  },
  "all": [
    {
      "tag": "button",
      "text": "Save",
      "visible": true
    }
  ]
}
```

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
