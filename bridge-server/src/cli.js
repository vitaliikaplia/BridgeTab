#!/usr/bin/env node
const { CONFIG_PATH, readConfig } = require("./config");
const { createServer } = require("./server");

async function main() {
  const config = readConfig();
  const app = createServer(config);
  await app.start();

  console.log("BridgeTab server is running.");
  console.log(`HTTP: http://${config.host}:${config.port}`);
  console.log(`WebSocket: ws://${config.host}:${config.port}/ws`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Token: ${config.token}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

