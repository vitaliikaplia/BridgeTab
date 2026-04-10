import { DEFAULT_SETTINGS } from "./storage.js";

const serverUrlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const allowlistInput = document.getElementById("allowlist");
const debugModeInput = document.getElementById("debugMode");
const statusBadge = document.getElementById("statusBadge");
const tabTitle = document.getElementById("tabTitle");
const tabUrl = document.getElementById("tabUrl");
const lastCommand = document.getElementById("lastCommand");
const transportMeta = document.getElementById("transportMeta");
const sessionMeta = document.getElementById("sessionMeta");
const feedbackCard = document.getElementById("feedbackCard");
const feedbackText = document.getElementById("feedbackText");
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");
const allowCurrentDomainButton = document.getElementById("allowCurrentDomain");
const openLogsButton = document.getElementById("openLogsButton");
const refreshButton = document.getElementById("refreshButton");

let refreshTimer = null;

async function request(action) {
  return chrome.runtime.sendMessage({ type: "popup_action", action });
}

function renderFeedback(message, tone = "success") {
  if (!message) {
    feedbackCard.className = "card feedback hidden";
    feedbackText.textContent = "";
    return;
  }

  feedbackCard.className = `card feedback is-${tone}`;
  feedbackText.textContent = message;
}

function renderStatus(settings, health = null) {
  const connected = settings.connected && settings.serverReachable;
  statusBadge.textContent = connected ? "Connected" : settings.serverReachable ? "Session offline" : "Bridge offline";
  statusBadge.className = `status ${connected ? "connected" : "disconnected"}`;
  transportMeta.textContent = settings.serverReachable
    ? health?.extensionConnected
      ? "Server reachable and paired"
      : "Server reachable, waiting for session"
    : "Transport offline";
  lastCommand.textContent = settings.lastCommand || "No commands yet";
  sessionMeta.textContent = health?.connectedSession?.connectedAt
    ? `Connected at ${new Date(health.connectedSession.connectedAt).toLocaleString()}`
    : settings.serverReachable
      ? "Bridge server is online, but this browser session is not paired."
      : "No active browser bridge session.";
}

function renderTab(activeTab) {
  tabTitle.textContent = activeTab?.title || "No active tab";
  tabUrl.textContent = activeTab?.url || "Open a tab to inspect its domain.";
}

function setBusy(isBusy) {
  [connectButton, disconnectButton, allowCurrentDomainButton, openLogsButton, refreshButton].forEach((button) => {
    button.disabled = isBusy;
  });
}

async function loadState() {
  const response = await request("get_state");
  const settings = response.settings || DEFAULT_SETTINGS;
  serverUrlInput.value = settings.serverUrl;
  tokenInput.value = settings.token;
  allowlistInput.value = settings.allowlist.join("\n");
  debugModeInput.checked = settings.debugMode;
  renderStatus(settings, response.health);
  renderTab(response.activeTab);
  if (settings.lastError) {
    renderFeedback(settings.lastError, "error");
  } else if (response.health?.extensionConnected) {
    renderFeedback("Browser session is paired with the local bridge.", "success");
  } else if (settings.serverReachable) {
    renderFeedback("Local bridge server is online. Click connect to pair this Chrome session.", "success");
  } else {
    renderFeedback("Bridge server is offline or unreachable. Start the local runner first.", "error");
  }
}

async function persistInputs() {
  await chrome.storage.local.set({
    serverUrl: serverUrlInput.value.trim(),
    token: tokenInput.value.trim(),
    allowlist: allowlistInput.value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    debugMode: debugModeInput.checked
  });
}

async function performAction(action, options = {}) {
  setBusy(true);
  try {
    if (options.persistFirst) {
      await persistInputs();
    }
    const response = await request(action);
    if (!response.success) {
      renderFeedback(response.error || "Action failed", "error");
      return;
    }

    if (action === "connect") {
      renderFeedback("Current Chrome session is now paired with the local bridge.", "success");
    } else if (action === "disconnect") {
      renderFeedback("Browser session disconnected from the local bridge.", "success");
    } else if (action === "allow_current_domain") {
      renderFeedback("Current domain added to the allowlist.", "success");
    } else if (action === "refresh_health") {
      renderFeedback("Bridge status refreshed from localhost.", "success");
    }
  } catch (error) {
    renderFeedback(error.message || "Unexpected error", "error");
  } finally {
    await loadState();
    setBusy(false);
  }
}

connectButton.addEventListener("click", async () => {
  await performAction("connect", { persistFirst: true });
});

disconnectButton.addEventListener("click", async () => {
  await performAction("disconnect");
});

allowCurrentDomainButton.addEventListener("click", async () => {
  await performAction("allow_current_domain", { persistFirst: true });
});

openLogsButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("logs.html") });
});

refreshButton.addEventListener("click", async () => {
  await performAction("refresh_health", { persistFirst: true });
});

[serverUrlInput, tokenInput, allowlistInput, debugModeInput].forEach((element) => {
  element.addEventListener("change", persistInputs);
});

async function init() {
  await loadState();
  refreshTimer = window.setInterval(() => {
    loadState().catch(() => {
      renderFeedback("Unable to refresh bridge status.", "error");
    });
  }, 5000);
}

window.addEventListener("unload", () => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
});

init();
