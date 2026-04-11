import { getSettings, updateSettings } from "./storage.js";

let socket = null;
let commandHandler = null;
let socketListenersAttached = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let activeConnectPromise = null;
let intentionalDisconnect = false;

export function setCommandHandler(handler) {
  commandHandler = handler;
}

export function getSocketState() {
  return socket?.readyState ?? WebSocket.CLOSED;
}

function deriveHttpBase(serverUrl) {
  const wsUrl = new URL(serverUrl);
  const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${wsUrl.host}`;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getReconnectDelay() {
  return Math.min(1000 * 2 ** reconnectAttempts, 15000);
}

async function syncBridgeHealth() {
  const settings = await getSettings();
  const baseUrl = deriveHttpBase(settings.serverUrl);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`);
    }
    const payload = await response.json();
    await updateSettings({
      serverReachable: true,
      connected: Boolean(payload.extensionConnected),
      extensionConnectedAt: payload.connectedSession?.connectedAt || null,
      sessionInfo: payload.connectedSession || null,
      lastError: null
    });
    return payload;
  } catch (error) {
    await updateSettings({
      serverReachable: false,
      connected: false,
      sessionInfo: null,
      extensionConnectedAt: null,
      lastError: error.message
    });
    throw error;
  }
}

function attachSocketListeners() {
  if (!socket || socketListenersAttached) {
    return;
  }

  socketListenersAttached = true;

  socket.addEventListener("close", async () => {
    socket = null;
    socketListenersAttached = false;
    await updateSettings({
      connected: false,
      extensionConnectedAt: null,
      sessionInfo: null
    });
    try {
      await syncBridgeHealth();
    } catch (_error) {
      // Ignore transport errors during reconnect.
    }

    const settings = await getSettings();
    if (!intentionalDisconnect && settings.bridgeWanted) {
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempts += 1;
        connectBridge(chrome.runtime.id, { restore: true }).catch(() => {
          // Follow-up reconnects are scheduled again from the next close/error path.
        });
      }, getReconnectDelay());
    }
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "connected") {
      clearReconnectTimer();
      reconnectAttempts = 0;
      const settings = await getSettings();
      await updateSettings({
        connected: true,
        serverReachable: true,
        extensionConnectedAt: message.serverTime || new Date().toISOString(),
        sessionInfo: settings.sessionInfo,
        bridgeWanted: settings.bridgeWanted
      });
      return;
    }

    if (message.type === "command" && commandHandler) {
      const response = await commandHandler(message);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(response));
      }
    }
  });
}

export async function connectBridge(extensionId, options = {}) {
  const settings = await getSettings();
  if (!settings.token) {
    throw new Error("Session token is required");
  }

  if (activeConnectPromise) {
    return activeConnectPromise;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    return syncBridgeHealth();
  }

  const url = new URL(settings.serverUrl);
  url.searchParams.set("token", settings.token);
  url.searchParams.set("extensionId", extensionId || chrome.runtime.id);
  url.searchParams.set("browserLabel", "Chrome");

  intentionalDisconnect = false;
  clearReconnectTimer();
  socket = new WebSocket(url.toString());
  attachSocketListeners();

  activeConnectPromise = new Promise((resolve, reject) => {
    socket.addEventListener(
      "open",
      async () => {
        await updateSettings({
          connected: true,
          serverReachable: true,
          lastError: null,
          bridgeWanted: true
        });
        const health = await syncBridgeHealth().catch(() => ({
          extensionConnected: true,
          connectedSession: null
        }));
        reconnectAttempts = 0;
        activeConnectPromise = null;
        resolve({
          connected: true,
          health
        });
      },
      { once: true }
    );

    socket.addEventListener(
      "error",
      async () => {
        socket = null;
        socketListenersAttached = false;
        await updateSettings({
          connected: false,
          serverReachable: false,
          extensionConnectedAt: null,
          sessionInfo: null,
          bridgeWanted: options.restore ? settings.bridgeWanted : true,
          lastError: "Failed to connect to bridge server"
        });
        activeConnectPromise = null;
        reject(new Error("Failed to connect to bridge server"));
      },
      { once: true }
    );
  });

  return activeConnectPromise;
}

export async function disconnectBridge() {
  intentionalDisconnect = true;
  clearReconnectTimer();
  activeConnectPromise = null;
  if (socket) {
    socket.close(1000, "Disconnected by user");
    socket = null;
    socketListenersAttached = false;
  }
  try {
    await updateSettings({
      bridgeWanted: false
    });
    await syncBridgeHealth();
  } catch (_error) {
    await updateSettings({
      bridgeWanted: false,
      connected: false,
      serverReachable: false,
      extensionConnectedAt: null,
      sessionInfo: null
    });
  }
}

export async function getBridgeHealth() {
  return syncBridgeHealth();
}

export async function ensureBridgeConnection(extensionId = chrome.runtime.id) {
  const settings = await getSettings();
  if (!settings.bridgeWanted) {
    return null;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    return syncBridgeHealth().catch(() => null);
  }

  return connectBridge(extensionId, { restore: true }).catch(() => null);
}
