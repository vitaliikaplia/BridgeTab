# BridgeTab Setup

## 1. Start the local bridge server

```bash
cd bridge-server
npm install
npm start
```

On first start BridgeTab creates `~/.bridgetab/config.json` with:

- `host`: always `127.0.0.1`
- `port`: default `17888`
- `token`: generated locally
- `screenshotDir`: local temp-like storage for PNG captures
- `logPath`: local audit log path

Copy the token from the terminal or config file.

## 2. Install the Chrome extension

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select the `extension/` directory

## 3. Connect the browser session

1. Open the BridgeTab popup
2. Paste the bridge WebSocket URL, usually `ws://127.0.0.1:17888/ws`
3. Paste the session token from `~/.bridgetab/config.json`
4. Review the allowlist domains
5. Click `Connect current session`

The popup is the explicit user confirmation step for enabling a browser session.

## 4. Call the localhost API

Examples:

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

## 5. Inspect logs and diagnostics

BridgeTab now includes an extension diagnostics page:

1. Open the popup
2. Click `Відкрити логи`
3. Review:
   - local extension storage
   - browser-side console and network logs for the active tab
   - `/health` response from the bridge server
   - `/capabilities` response from the bridge server
   - `/logs` audit entries from the server, if the token is saved
