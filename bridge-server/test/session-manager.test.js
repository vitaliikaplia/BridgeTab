const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionManager } = require("../src/session-manager");

function createSocket() {
  return {
    readyState: 1,
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
    closeCode: null,
    closeReason: null,
    close(code, reason) {
      this.closeCode = code;
      this.closeReason = reason;
    }
  };
}

test("sendCommand rejects when no session is active", async () => {
  const manager = new SessionManager();

  await assert.rejects(
    () => manager.sendCommand({ command: "ping" }),
    (error) => error.code === "NO_ACTIVE_SESSION"
  );
});

test("sendCommand sends payload and resolves when result arrives", async () => {
  const manager = new SessionManager();
  const socket = createSocket();
  manager.connectExtension(socket, { extensionId: "ext-1", browserLabel: "Chrome" });

  const pending = manager.sendCommand({ command: "ping" }, 1000);
  assert.equal(socket.sent.length, 1);

  const message = JSON.parse(socket.sent[0]);
  assert.equal(message.command, "ping");
  assert.equal(message.type, "command");
  assert.ok(message.requestId);

  manager.handleMessage({
    type: "command_result",
    requestId: message.requestId,
    success: true,
    tabId: null,
    result: { pong: true }
  });

  const result = await pending;
  assert.equal(result.success, true);
  assert.deepEqual(result.result, { pong: true });
});

test("disconnectExtension rejects all pending commands", async () => {
  const manager = new SessionManager();
  const socket = createSocket();
  manager.connectExtension(socket, { extensionId: "ext-1", browserLabel: "Chrome" });

  const pending = manager.sendCommand({ command: "ping" }, 1000);
  manager.disconnectExtension();

  await assert.rejects(
    () => pending,
    (error) => error.code === "NO_ACTIVE_SESSION"
  );
});
