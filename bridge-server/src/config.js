const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR = path.join(os.homedir(), ".bridgetab");
const CONFIG_PATH = path.join(APP_DIR, "config.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function readConfig() {
  ensureDir(APP_DIR);

  const defaults = {
    host: "127.0.0.1",
    port: Number(process.env.BRIDGETAB_PORT || 17888),
    token: generateToken(),
    screenshotDir: path.join(APP_DIR, "screenshots"),
    logPath: path.join(APP_DIR, "audit.log"),
    debugMode: false
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    ensureDir(defaults.screenshotDir);
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    return defaults;
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const config = {
    ...defaults,
    ...parsed,
    host: "127.0.0.1"
  };

  ensureDir(config.screenshotDir);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

module.exports = {
  APP_DIR,
  CONFIG_PATH,
  readConfig
};

