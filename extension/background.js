import { connectBridge, disconnectBridge, ensureBridgeConnection, getBridgeHealth, setCommandHandler } from "./bridge-client.js";
import { getSettings, updateSettings } from "./storage.js";

const consoleLogs = new Map();
const networkLogs = new Map();
const MAX_LOGS = 200;

function pushBounded(map, key, entry) {
  const current = map.get(key) || [];
  current.unshift(entry);
  map.set(key, current.slice(0, MAX_LOGS));
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
        await assertHostnameAllowed(args.url);
        if (args.createNew) {
          const createdTab = await chrome.tabs.create({ url: args.url, active: true });
          effectiveTabId = createdTab.id;
        } else {
          effectiveTabId = await resolveTabId(tabId);
          await chrome.tabs.update(effectiveTabId, { url: args.url });
        }
        const tab = await chrome.tabs.get(effectiveTabId);
        result = {
          tabId: effectiveTabId,
          url: tab.url,
          title: tab.title || ""
        };
        break;
      }
      case "get_page_state":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "get_page_state");
        break;
      case "query":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "query", args);
        break;
      case "click":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "click", args);
        break;
      case "focus":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "focus", args);
        break;
      case "hover":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "hover", args);
        break;
      case "type":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "type", args);
        break;
      case "clear":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "clear", args);
        break;
      case "select_option":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "select_option", args);
        break;
      case "press_keys":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "press_keys", args);
        break;
      case "wait_for":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "wait_for", args);
        break;
      case "scroll_into_view":
        effectiveTabId = await resolveTabId(tabId);
        result = await sendContentCommand(effectiveTabId, "scroll_into_view", args);
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
        result = await sendContentCommand(effectiveTabId, "get_local_storage", args);
        break;
      case "reload":
        effectiveTabId = await resolveTabId(tabId);
        await withTab(effectiveTabId, async () => chrome.tabs.reload(effectiveTabId));
        result = { reloaded: true };
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
  await ensureBridgeConnection(chrome.runtime.id);
});

chrome.runtime.onStartup.addListener(async () => {
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
