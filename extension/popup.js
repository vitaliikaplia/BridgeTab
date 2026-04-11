import { DEFAULT_SETTINGS } from "./storage.js";

const serverUrlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const allowlistInput = document.getElementById("allowlist");
const debugModeInput = document.getElementById("debugMode");
const statusBadge = document.getElementById("statusBadge");
const tabTitle = document.getElementById("tabTitle");
const tabUrl = document.getElementById("tabUrl");
const domainMeta = document.getElementById("domainMeta");
const lastCommand = document.getElementById("lastCommand");
const transportMeta = document.getElementById("transportMeta");
const capabilitiesMeta = document.getElementById("capabilitiesMeta");
const sessionMeta = document.getElementById("sessionMeta");
const feedbackCard = document.getElementById("feedbackCard");
const feedbackText = document.getElementById("feedbackText");
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");
const allowCurrentDomainButton = document.getElementById("allowCurrentDomain");
const openLogsButton = document.getElementById("openLogsButton");
const refreshButton = document.getElementById("refreshButton");
const pingButton = document.getElementById("pingButton");
const pageStateButton = document.getElementById("pageStateButton");
const quickResult = document.getElementById("quickResult");

let refreshTimer = null;

async function request(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: "popup_action", action, ...payload });
}

function hostMatchesRule(hostname, rule) {
  if (!rule) {
    return false;
  }
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === rule;
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
  statusBadge.textContent = connected ? "Підключено" : settings.serverReachable ? "Сесія офлайн" : "Bridge офлайн";
  statusBadge.className = `status ${connected ? "connected" : "disconnected"}`;
  transportMeta.textContent = settings.serverReachable
    ? health?.extensionConnected
      ? "Сервер доступний і сесію підключено"
      : "Сервер доступний, очікування сесії"
    : "Транспорт недоступний";
  lastCommand.textContent = settings.lastCommand || "Команд ще не було";
  sessionMeta.textContent = health?.connectedSession?.connectedAt
    ? `Підключено: ${new Date(health.connectedSession.connectedAt).toLocaleString("uk-UA")}`
    : settings.serverReachable
      ? "Bridge server онлайн, але ця browser-сесія ще не підключена."
      : "Немає активної bridge-сесії браузера.";
}

function renderCapabilities(capabilities) {
  if (!capabilities?.commands?.length) {
    capabilitiesMeta.textContent = "Capabilities недоступні, поки сервер не відповідає.";
    return;
  }
  capabilitiesMeta.textContent = `Доступно команд: ${capabilities.commands.length}. Protocol v${capabilities.protocolVersion}.`;
}

function renderTab(activeTab) {
  tabTitle.textContent = activeTab?.title || "Немає активної вкладки";
  tabUrl.textContent = activeTab?.url || "Відкрий вкладку, щоб перевірити її домен.";
}

function renderDomainState(activeTab, settings) {
  if (!activeTab?.url) {
    domainMeta.textContent = "Статус домену недоступний, поки немає активної вкладки.";
    return;
  }

  try {
    const hostname = new URL(activeTab.url).hostname;
    const allowed = settings.allowlist.some((rule) => hostMatchesRule(hostname, rule));
    domainMeta.textContent = allowed
      ? `Домен ${hostname} дозволений для bridge-команд.`
      : `Домен ${hostname} зараз не в allowlist.`;
  } catch (_error) {
    domainMeta.textContent = "Для цієї вкладки неможливо визначити статус домену.";
  }
}

function setBusy(isBusy) {
  [connectButton, disconnectButton, allowCurrentDomainButton, openLogsButton, refreshButton, pingButton, pageStateButton].forEach((button) => {
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
  renderCapabilities(response.capabilities);
  renderTab(response.activeTab);
  renderDomainState(response.activeTab, settings);
  if (settings.lastError) {
    renderFeedback(settings.lastError, "error");
  } else if (response.health?.extensionConnected) {
    renderFeedback("Сесію браузера підключено до локального bridge.", "success");
  } else if (settings.serverReachable) {
    renderFeedback("Локальний bridge server онлайн. Натисни підключення, щоб прив’язати цю Chrome-сесію.", "success");
  } else {
    renderFeedback("Bridge server офлайн або недоступний. Спершу запусти локальний runner.", "error");
  }
}

function renderQuickResult(payload) {
  quickResult.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
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
      renderFeedback(response.error || "Дію не виконано", "error");
      return;
    }

    if (action === "connect") {
      renderFeedback("Поточну Chrome-сесію підключено до локального bridge.", "success");
    } else if (action === "disconnect") {
      renderFeedback("Сесію браузера відключено від локального bridge.", "success");
    } else if (action === "allow_current_domain") {
      renderFeedback("Поточний домен додано до списку дозволених.", "success");
    } else if (action === "refresh_health") {
      renderFeedback("Статус bridge оновлено з localhost.", "success");
    }
  } catch (error) {
    renderFeedback(error.message || "Неочікувана помилка", "error");
  } finally {
    await loadState();
    setBusy(false);
  }
}

async function runQuickCommand(command) {
  setBusy(true);
  try {
    const response = await request("run_quick_command", { command });
    if (!response.success) {
      renderQuickResult(response.error || "Команда завершилась з помилкою.");
      renderFeedback(response.error || "Команда завершилась з помилкою.", "error");
      return;
    }
    renderQuickResult(response.result);
    renderFeedback(`Швидку команду ${command} виконано.`, "success");
  } catch (error) {
    renderQuickResult(error.message || "Не вдалося виконати швидку команду.");
    renderFeedback(error.message || "Не вдалося виконати швидку команду.", "error");
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

pingButton.addEventListener("click", async () => {
  await runQuickCommand("ping");
});

pageStateButton.addEventListener("click", async () => {
  await runQuickCommand("get_page_state");
});

[serverUrlInput, tokenInput, allowlistInput, debugModeInput].forEach((element) => {
  element.addEventListener("change", persistInputs);
});

async function init() {
  await loadState();
  refreshTimer = window.setInterval(() => {
    loadState().catch(() => {
      renderFeedback("Не вдалося оновити статус bridge.", "error");
    });
  }, 5000);
}

window.addEventListener("unload", () => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
});

init();
