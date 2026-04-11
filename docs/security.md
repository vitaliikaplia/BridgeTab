# BridgeTab Security

## Localhost only

The bridge server binds only to `127.0.0.1`. It never listens on `0.0.0.0`.

## Session token

- A random session token is generated locally on first start.
- The token is stored only in `~/.bridgetab/config.json`.
- HTTP commands and the extension WebSocket handshake both require the token.

To rotate the token, stop the server, edit `~/.bridgetab/config.json`, replace the token, and reconnect the extension.

## Explicit user action

The extension does not automatically open a bridge session. The user must click `Connect` in the popup.

## Allowlist

- Domains are checked in the extension before tab commands run.
- Default starter rules are `localhost` and `*.test`.
- The popup can add the current domain to the allowlist and shows whether the active tab is currently allowed.

## Risk boundaries in MVP

- No remote access mode
- No cloud sync
- No arbitrary JavaScript evaluation
- Audit logging is local and avoids sensitive payload recording
- `get_local_storage` is explicit and returns only storage values for the selected origin; it does not enable arbitrary script execution
