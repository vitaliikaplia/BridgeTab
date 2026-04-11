const test = require("node:test");
const assert = require("node:assert/strict");
const { CommandRouter } = require("../src/command-router");

test("dispatch stores screenshot files and strips screenshotBase64 from result", async () => {
  let saved = null;
  const router = new CommandRouter({
    sessionManager: {
      async sendCommand() {
        return {
          success: true,
          tabId: 5,
          result: {
            screenshotBase64: "ZmFrZQ==",
            rect: { x: 1, y: 2, width: 3, height: 4 }
          },
          error: null
        };
      }
    },
    screenshotStore: {
      savePng(base64, prefix) {
        saved = { base64, prefix };
        return "/tmp/capture.png";
      }
    },
    logger: {
      add() {}
    }
  });

  const response = await router.dispatch({
    command: "screenshot_page",
    tabId: 5
  });

  assert.deepEqual(saved, {
    base64: "ZmFrZQ==",
    prefix: "screenshot_page"
  });
  assert.equal(response.success, true);
  assert.equal(response.result.path, "/tmp/capture.png");
  assert.equal("screenshotBase64" in response.result, false);
});

test("formatError preserves structured errors", () => {
  const router = new CommandRouter({
    sessionManager: {},
    screenshotStore: {},
    logger: { add() {} }
  });

  const error = {
    code: "NO_ACTIVE_SESSION",
    message: "No active bridge session"
  };

  const response = router.formatError(error, "click");
  assert.equal(response.error.code, "NO_ACTIVE_SESSION");
  assert.equal(response.command, "click");
});
