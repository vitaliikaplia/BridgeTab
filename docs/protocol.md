# BridgeTab Protocol

All commands use the same JSON envelope over `POST /command`.

## Request

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

## Response

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

## MVP commands

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

## Command notes

### `navigate`

Args:

```json
{
  "url": "https://example.test",
  "createNew": true
}
```

### `query`

Args:

```json
{
  "selector": "button.primary",
  "all": true
}
```

Typical result:

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

Returns:

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

Returns a buffered array of `console.error`, `console.warn`, `window.onerror`, and `unhandledrejection` events:

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

Returns failed requests and HTTP `4xx/5xx` responses captured by the extension:

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

### `screenshot_page`

Returns a PNG path created by the bridge server:

```json
{
  "path": "/Users/you/.bridgetab/screenshots/screenshot-page-1712800000000.png"
}
```

## Errors

BridgeTab returns compact structured errors such as:

```json
{
  "code": "COMMAND_FAILED",
  "message": "Element not found"
}
```
