const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Logger } = require("../src/logger");

test("logger clear resets in-memory entries and file content", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridgetab-logger-"));
  const logPath = path.join(tempDir, "audit.log");
  const logger = new Logger(logPath);

  logger.add({ scope: "test", command: "ping", success: true });
  assert.equal(logger.list().length, 1);
  assert.match(fs.readFileSync(logPath, "utf8"), /"command":"ping"/);

  logger.clear();

  assert.deepEqual(logger.list(), []);
  assert.equal(fs.readFileSync(logPath, "utf8"), "");
});
