export const DEFAULT_SETTINGS = {
  serverUrl: "ws://127.0.0.1:17888/ws",
  token: "",
  allowlist: ["localhost", "*.test"],
  debugMode: false,
  bridgeWanted: false,
  connected: false,
  lastCommand: null,
  lastError: null,
  serverReachable: false,
  extensionConnectedAt: null,
  sessionInfo: null
};

export async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...data
  };
}

export async function updateSettings(patch) {
  await chrome.storage.local.set(patch);
  return getSettings();
}
