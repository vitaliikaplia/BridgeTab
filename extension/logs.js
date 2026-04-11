const refreshButton = document.getElementById("refreshButton");
const clearBrowserButton = document.getElementById("clearBrowserButton");
const clearServerButton = document.getElementById("clearServerButton");
const healthDump = document.getElementById("healthDump");
const capabilitiesDump = document.getElementById("capabilitiesDump");
const serverLogsDump = document.getElementById("serverLogsDump");
const consoleLogsDump = document.getElementById("consoleLogsDump");
const networkLogsDump = document.getElementById("networkLogsDump");
const storageDump = document.getElementById("storageDump");

async function render() {
  const diagnostics = await chrome.runtime.sendMessage({
    type: "popup_action",
    action: "get_diagnostics"
  });

  if (!diagnostics.success) {
    throw new Error(diagnostics.error || "Не вдалося отримати diagnostics");
  }

  storageDump.textContent = JSON.stringify(diagnostics.settings, null, 2);
  healthDump.textContent = diagnostics.health
    ? JSON.stringify(diagnostics.health, null, 2)
    : "Сервер зараз недоступний.";
  capabilitiesDump.textContent = diagnostics.capabilities
    ? JSON.stringify(diagnostics.capabilities, null, 2)
    : "Capabilities зараз недоступні.";
  consoleLogsDump.textContent = JSON.stringify(diagnostics.consoleLogs, null, 2);
  networkLogsDump.textContent = JSON.stringify(diagnostics.networkLogs, null, 2);

  if (!diagnostics.settings.token) {
    serverLogsDump.textContent = "Щоб читати audit-логи сервера, збережи session token.";
    return;
  }

  if (!diagnostics.settings.serverUrl) {
    serverLogsDump.textContent = "Bridge URL ще не збережено.";
    return;
  }

  try {
    const wsUrl = new URL(diagnostics.settings.serverUrl);
    const protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
    const baseUrl = `${protocol}//${wsUrl.host}`;
    const logsResponse = await fetch(`${baseUrl}/logs`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "X-Bridge-Token": diagnostics.settings.token
      }
    });
    const logs = await logsResponse.json();
    serverLogsDump.textContent = JSON.stringify(logs, null, 2);
  } catch (error) {
    serverLogsDump.textContent = `Не вдалося отримати /logs: ${error.message}`;
  }
}

refreshButton.addEventListener("click", () => {
  render().catch((error) => {
    healthDump.textContent = `Не вдалося оновити діагностику: ${error.message}`;
  });
});

clearBrowserButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "popup_action",
    action: "clear_diagnostics",
    scope: "browser",
    tabOnly: true
  });
  await render();
});

clearServerButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "popup_action",
    action: "clear_diagnostics",
    scope: "server"
  });
  await render();
});

render();
