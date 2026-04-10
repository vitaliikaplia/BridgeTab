import { getSettings, updateSettings } from "./storage.js";

let socket = null;
let commandHandler = null;
let socketListenersAttached = false;

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
      return;
    }
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "connected") {
      const settings = await getSettings();
      await updateSettings({
        connected: true,
        serverReachable: true,
        extensionConnectedAt: message.serverTime || new Date().toISOString(),
        sessionInfo: settings.sessionInfo
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

export async function connectBridge(extensionId) {
  const settings = await getSettings();
  if (!settings.token) {
    throw new Error("Session token is required");
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    return syncBridgeHealth();
  }

  const url = new URL(settings.serverUrl);
  url.searchParams.set("token", settings.token);
  url.searchParams.set("extensionId", extensionId);
  url.searchParams.set("browserLabel", "Chrome");

  socket = new WebSocket(url.toString());
  attachSocketListeners();

  return new Promise((resolve, reject) => {
    socket.addEventListener(
      "open",
      async () => {
        await updateSettings({
          connected: true,
          serverReachable: true,
          lastError: null
        });
        const health = await syncBridgeHealth().catch(() => ({
          extensionConnected: true,
          connectedSession: null
        }));
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
          lastError: "Failed to connect to bridge server"
        });
        reject(new Error("Failed to connect to bridge server"));
      },
      { once: true }
    );
  });
}

export async function disconnectBridge() {
  if (socket) {
    socket.close(1000, "Disconnected by user");
    socket = null;
    socketListenersAttached = false;
  }
  try {
    await syncBridgeHealth();
  } catch (_error) {
    await updateSettings({
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
