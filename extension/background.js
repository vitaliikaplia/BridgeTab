import { connectBridge, disconnectBridge, ensureBridgeConnection, getBridgeHealth, setCommandHandler } from "./bridge-client.js";
import { getSettings, updateSettings } from "./storage.js";

const consoleLogs = new Map();
const networkLogs = new Map();
const MAX_LOGS = 200;
const ACTION_ICON_SIZES = [16, 32, 48, 128];
const ACTION_ICON_COLORS = {
  connected: {
    background: "#159a6d",
    foreground: "#f4efe7"
  },
  disconnected: {
    background: "#7f7a72",
    foreground: "#f4efe7"
  }
};

function pushBounded(map, key, entry) {
  const current = map.get(key) || [];
  current.unshift(entry);
  map.set(key, current.slice(0, MAX_LOGS));
}

function buildActionIconImageData(size, palette) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = palette.background;
  ctx.beginPath();
  ctx.roundRect(1, 1, size - 2, size - 2, Math.max(4, Math.round(size * 0.24)));
  ctx.fill();

  ctx.fillStyle = palette.foreground;
  ctx.font = `700 ${Math.round(size * 0.56)}px Georgia`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", size / 2, size / 2 + size * 0.03);

  return ctx.getImageData(0, 0, size, size);
}

async function updateActionIcon(connected) {
  const palette = connected ? ACTION_ICON_COLORS.connected : ACTION_ICON_COLORS.disconnected;
  const imageData = Object.fromEntries(
    ACTION_ICON_SIZES.map((size) => [size, buildActionIconImageData(size, palette)])
  );

  await chrome.action.setIcon({ imageData });
  await chrome.action.setTitle({
    title: connected ? "BridgeTab: сесію підключено" : "BridgeTab: сесію відключено"
  });
}

async function refreshActionIconFromSettings() {
  const settings = await getSettings();
  await updateActionIcon(Boolean(settings.connected && settings.serverReachable));
}

function hostMatchesRule(hostname, rule) {
  if (!rule) {
    return false;
  }
  if (rule.startsWith("*.")) {
    return hostname === rule.slice(2) || hostname.endsWith(`.${rule.slice(2)}`);
  }
  return hostname === rule;
}

function isUrlProtocolAllowed(tabUrl) {
  return /^https?:/i.test(tabUrl);
}

async function resolveTabId(tabId) {
  if (tabId) {
    return tabId;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error("Tab not found");
  }
  return activeTab.id;
}

async function assertHostnameAllowed(urlString) {
  const settings = await getSettings();
  const parsed = new URL(urlString);
  const allowed = settings.allowlist.some((rule) => hostMatchesRule(parsed.hostname, rule));
  if (!allowed) {
    throw new Error(`Domain ${parsed.hostname} is not allowlisted`);
  }
}

async function isTabAllowed(tabId) {
  const settings = await getSettings();
  if (!settings.connected) {
    throw new Error("No active bridge session");
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isUrlProtocolAllowed(tab.url)) {
    throw new Error("Only http and https tabs are supported");
  }
  const url = new URL(tab.url);
  const allowed = settings.allowlist.some((rule) => hostMatchesRule(url.hostname, rule));
  if (!allowed) {
    throw new Error(`Domain ${url.hostname} is not allowlisted`);
  }
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

function normalizeError(error) {
  return {
    code: "COMMAND_FAILED",
    message: error.message
  };
}

function deriveHttpBase(serverUrl) {
  const wsUrl = new URL(serverUrl);
  const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  return `${protocol}//${wsUrl.host}`;
}

function getLogSnapshot(map, tabId = null) {
  if (tabId != null) {
    return {
      scope: "tab",
      tabId,
      entries: map.get(tabId) || []
    };
  }

  return {
    scope: "all",
    entriesByTab: Object.fromEntries(map.entries())
  };
}

function clearLogMap(map, tabId = null) {
  if (tabId != null) {
    map.delete(tabId);
    return;
  }
  map.clear();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabLoadComplete(tabId, { expectedUrl = null, timeoutMs = 15000 } = {}) {
  const tabMatches = (tab) => {
    if (!tab) {
      return false;
    }
    if (expectedUrl && tab.url !== expectedUrl) {
      return false;
    }
    return tab.status === "complete";
  };

  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (tabMatches(existing)) {
    return existing;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for tab navigation to complete"));
    }, timeoutMs);

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    };

    const handleUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status !== "complete") {
        return;
      }
      if (!tabMatches(tab)) {
        return;
      }
      cleanup();
      resolve(tab);
    };

    const handleRemoved = (removedTabId) => {
      if (removedTabId !== tabId) {
        return;
      }
      cleanup();
      reject(new Error("Tab was closed during navigation"));
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
  });
}

async function waitForContentReady(tabId, { expectedUrl = null, timeoutMs = 8000 } = {}) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start <= timeoutMs) {
    try {
      const state = await sendContentCommand(tabId, "get_page_state");
      const ready = state.readyState === "interactive" || state.readyState === "complete";
      const urlMatches = !expectedUrl || state.url === expectedUrl;
      if (ready && urlMatches) {
        await delay(150);
        const confirmedState = await sendContentCommand(tabId, "get_page_state");
        const confirmedReady = confirmedState.readyState === "interactive" || confirmedState.readyState === "complete";
        const confirmedUrlMatches = !expectedUrl || confirmedState.url === expectedUrl;
        if (confirmedReady && confirmedUrlMatches) {
          return confirmedState;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await delay(150);
  }

  throw new Error(lastError?.message || "Timed out waiting for content script readiness");
}

async function waitForStablePage(tabId, options = {}) {
  await waitForTabLoadComplete(tabId, options);
  return waitForContentReady(tabId, options);
}

async function fetchCapabilities() {
  const settings = await getSettings();
  if (!settings.serverUrl) {
    throw new Error("Bridge URL is not configured");
  }

  const response = await fetch(`${deriveHttpBase(settings.serverUrl)}/capabilities`, {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Capabilities request failed with status ${response.status}`);
  }
  return response.json();
}

async function clearServerLogs() {
  const settings = await getSettings();
  if (!settings.serverUrl || !settings.token) {
    throw new Error("Bridge URL or token is missing");
  }

  const response = await fetch(`${deriveHttpBase(settings.serverUrl)}/logs/clear`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      token: settings.token
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error?.message || "Failed to clear server logs");
  }
  return payload;
}

async function withTab(tabId, fn) {
  const tab = await isTabAllowed(tabId);
  await ensureContentScript(tabId);
  return fn(tab);
}

async function sendContentCommand(tabId, command, args = {}) {
  return withTab(tabId, async () => {
    const response = await chrome.tabs.sendMessage(tabId, { command, args });
    if (!response) {
      throw new Error("No response from content script");
    }
    if (response.success === false) {
      throw new Error(response.error || "Content command failed");
    }
    return response;
  });
}

async function signalActivityOverlay(tabId, phase) {
  try {
    await withTab(tabId, async () => {
      await chrome.tabs.sendMessage(tabId, {
        command: phase === "start" ? "__activity_start" : "__activity_end",
        args: {}
      });
    });
  } catch (_error) {
    // Ignore overlay signaling failures so command execution keeps working.
  }
}

async function runInteractiveTabCommand(tabId, command, args = {}, fn = null) {
  await signalActivityOverlay(tabId, "start");

  try {
    if (fn) {
      return await fn();
    }
    return await sendContentCommand(tabId, command, args);
  } finally {
    await signalActivityOverlay(tabId, "end");
  }
}

async function captureVisiblePng(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return dataUrl.split(",")[1];
}

async function cropScreenshot(base64Png, rect, scale = 1) {
  const binary = Uint8Array.from(atob(base64Png), (char) => char.charCodeAt(0));
  const blob = new Blob([binary], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale)));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    bitmap,
    Math.round(rect.x * scale),
    Math.round(rect.y * scale),
    Math.round(rect.width * scale),
    Math.round(rect.height * scale),
    0,
    0,
    Math.max(1, Math.round(rect.width * scale)),
    Math.max(1, Math.round(rect.height * scale))
  );
  const cropped = await canvas.convertToBlob({ type: "image/png" });
  const arrayBuffer = await cropped.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => tab.id && tab.url)
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || "",
      url: tab.url,
      active: Boolean(tab.active)
    }));
}

async function handleCommand(message) {
  const { requestId, command, args = {}, tabId } = message;

  try {
    let result;
    let effectiveTabId = await resolveTabId(tabId).catch(() => null);

    switch (command) {
      case "ping":
        result = { pong: true, timestamp: new Date().toISOString() };
        break;
      case "list_tabs":
        result = await listTabs();
        break;
      case "activate_tab":
        effectiveTabId = await resolveTabId(tabId);
        await chrome.tabs.update(effectiveTabId, { active: true });
        result = { activated: true };
        break;
      case "navigate": {
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "navigate", args, async () => {
          await assertHostnameAllowed(args.url);
          if (args.createNew) {
            const createdTab = await chrome.tabs.create({ url: args.url, active: true });
            effectiveTabId = createdTab.id;
          } else {
            await chrome.tabs.update(effectiveTabId, { url: args.url });
          }
          const pageState = await waitForStablePage(effectiveTabId, {
            expectedUrl: args.url,
            timeoutMs: args.timeoutMs || 15000
          });
          await signalActivityOverlay(effectiveTabId, "start");
          const tab = await chrome.tabs.get(effectiveTabId);
          return {
            tabId: effectiveTabId,
            url: pageState.url || tab.url,
            title: pageState.title || tab.title || "",
            readyState: pageState.readyState
          };
        });
        break;
      }
      case "get_page_state":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "get_page_state", args);
        break;
      case "query":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "query", args);
        break;
      case "click":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "click", args);
        break;
      case "focus":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "focus", args);
        break;
      case "hover":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "hover", args);
        break;
      case "type":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "type", args);
        break;
      case "clear":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "clear", args);
        break;
      case "select_option":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "select_option", args);
        break;
      case "press_keys":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "press_keys", args);
        break;
      case "wait_for":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "wait_for", args);
        break;
      case "scroll_into_view":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "scroll_into_view", args);
        break;
      case "screenshot_page":
        effectiveTabId = await resolveTabId(tabId);
        await isTabAllowed(effectiveTabId);
        result = {
          screenshotBase64: await captureVisiblePng(effectiveTabId)
        };
        break;
      case "screenshot_element": {
        effectiveTabId = await resolveTabId(tabId);
        await sendContentCommand(effectiveTabId, "scroll_into_view", { selector: args.selector });
        const elementData = await sendContentCommand(effectiveTabId, "query", { selector: args.selector });
        if (!elementData.exists || !elementData.first?.rect) {
          throw new Error("Element not found");
        }
        const base = await captureVisiblePng(effectiveTabId);
        result = {
          screenshotBase64: await cropScreenshot(base, elementData.first.rect, elementData.first.devicePixelRatio || 1),
          rect: elementData.first.rect
        };
        break;
      }
      case "get_console_logs":
        effectiveTabId = await resolveTabId(tabId);
        await isTabAllowed(effectiveTabId);
        result = consoleLogs.get(effectiveTabId) || [];
        break;
      case "get_network_errors":
        effectiveTabId = await resolveTabId(tabId);
        await isTabAllowed(effectiveTabId);
        result = networkLogs.get(effectiveTabId) || [];
        break;
      case "get_local_storage":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "get_local_storage", args);
        break;
      case "reload":
        effectiveTabId = await resolveTabId(tabId);
        result = await runInteractiveTabCommand(effectiveTabId, "reload", args, async () => {
          await withTab(effectiveTabId, async () => chrome.tabs.reload(effectiveTabId, { bypassCache: true }));
          const settledState = await waitForStablePage(effectiveTabId, {
            timeoutMs: args.timeoutMs || 15000
          });
          await signalActivityOverlay(effectiveTabId, "start");
          return {
            ...settledState,
            reloaded: true
          };
        });
        break;
      default:
        throw new Error(`Unsupported command: ${command}`);
    }

    await updateSettings({ lastCommand: `${command} @ ${new Date().toLocaleTimeString()}` });

    return {
      type: "command_result",
      requestId,
      success: true,
      tabId: effectiveTabId,
      result
    };
  } catch (error) {
    return {
      type: "command_result",
      requestId,
      success: false,
      tabId: tabId || null,
      result: null,
      error: normalizeError(error)
    };
  }
}

setCommandHandler(handleCommand);

chrome.runtime.onInstalled.addListener(async () => {
  await updateSettings({});
  await refreshActionIconFromSettings();
  await ensureBridgeConnection(chrome.runtime.id);
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshActionIconFromSettings();
  await ensureBridgeConnection(chrome.runtime.id);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    await ensureBridgeConnection(chrome.runtime.id);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "console_log" && sender.tab?.id) {
    pushBounded(consoleLogs, sender.tab.id, message.entry);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "popup_action") {
    (async () => {
      try {
        if (message.action === "connect") {
          const result = await connectBridge(chrome.runtime.id);
          sendResponse({ success: true, result });
        } else if (message.action === "disconnect") {
          await disconnectBridge();
          sendResponse({ success: true });
        } else if (message.action === "get_state") {
          await ensureBridgeConnection(chrome.runtime.id);
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          let health = null;
          let capabilities = null;
          try {
            health = await getBridgeHealth();
          } catch (_error) {
            health = null;
          }
          try {
            capabilities = await fetchCapabilities();
          } catch (_error) {
            capabilities = null;
          }
          const settings = await getSettings();
          sendResponse({
            success: true,
            settings,
            health,
            capabilities,
            activeTab: activeTab
              ? { title: activeTab.title || "", url: activeTab.url || "", tabId: activeTab.id || null }
              : null
          });
        } else if (message.action === "get_diagnostics") {
          await ensureBridgeConnection(chrome.runtime.id);
          const settings = await getSettings();
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          let health = null;
          let capabilities = null;
          try {
            health = await getBridgeHealth();
          } catch (_error) {
            health = null;
          }
          try {
            capabilities = await fetchCapabilities();
          } catch (_error) {
            capabilities = null;
          }
          sendResponse({
            success: true,
            settings,
            health,
            capabilities,
            activeTab: activeTab
              ? { title: activeTab.title || "", url: activeTab.url || "", tabId: activeTab.id || null }
              : null,
            consoleLogs: getLogSnapshot(consoleLogs, activeTab?.id || null),
            networkLogs: getLogSnapshot(networkLogs, activeTab?.id || null)
          });
        } else if (message.action === "clear_diagnostics") {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (message.scope === "browser") {
            clearLogMap(consoleLogs, message.tabOnly ? activeTab?.id || null : null);
            clearLogMap(networkLogs, message.tabOnly ? activeTab?.id || null : null);
            sendResponse({ success: true, cleared: true });
          } else if (message.scope === "server") {
            const payload = await clearServerLogs();
            sendResponse({ success: true, result: payload });
          } else {
            throw new Error("Unknown diagnostics scope");
          }
        } else if (message.action === "run_quick_command") {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id) {
            throw new Error("No active tab");
          }
          const result = await handleCommand({
            requestId: `popup-${Date.now()}`,
            command: message.command,
            tabId: activeTab.id,
            args: message.args || {}
          });
          sendResponse({ success: result.success, result: result.result, error: result.error?.message || null });
        } else if (message.action === "refresh_health") {
          await ensureBridgeConnection(chrome.runtime.id);
          const health = await getBridgeHealth();
          const settings = await getSettings();
          let capabilities = null;
          try {
            capabilities = await fetchCapabilities();
          } catch (_error) {
            capabilities = null;
          }
          sendResponse({ success: true, health, settings, capabilities });
        } else if (message.action === "allow_current_domain") {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.url) {
            throw new Error("No active tab");
          }
          const hostname = new URL(activeTab.url).hostname;
          const settings = await getSettings();
          const allowlist = Array.from(new Set([...settings.allowlist, hostname]));
          await updateSettings({ allowlist });
          sendResponse({ success: true, allowlist });
        }
      } catch (error) {
        await updateSettings({ lastError: error.message });
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.connected || changes.serverReachable) {
    await refreshActionIconFromSettings();
  }
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }
    if (details.statusCode >= 400) {
      pushBounded(networkLogs, details.tabId, {
        url: details.url,
        method: details.method,
        status: details.statusCode,
        type: "http_error",
        timestamp: new Date().toISOString()
      });
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }
    pushBounded(networkLogs, details.tabId, {
      url: details.url,
      method: details.method,
      status: 0,
      type: details.error,
      timestamp: new Date().toISOString()
    });
  },
  { urls: ["<all_urls>"] }
);
