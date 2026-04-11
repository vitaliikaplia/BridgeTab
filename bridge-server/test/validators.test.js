const test = require("node:test");
const assert = require("node:assert/strict");
const { requireCommandBody } = require("../src/validators");

test("requireCommandBody accepts a valid query command", () => {
  assert.doesNotThrow(() =>
    requireCommandBody({
      command: "query",
      tabId: 1,
      args: {
        selector: "button"
      },
      timeoutMs: 5000
    })
  );
});

test("requireCommandBody rejects unsupported commands", () => {
  assert.throws(
    () => requireCommandBody({ command: "do_magic" }),
    (error) => error.code === "BAD_REQUEST" && /Unsupported command/.test(error.message)
  );
});

test("requireCommandBody rejects missing required args", () => {
  assert.throws(
    () => requireCommandBody({ command: "click", args: {} }),
    (error) => error.code === "BAD_REQUEST" && error.message === "Command click requires args.selector"
  );
});

test("requireCommandBody accepts focus and clear commands", () => {
  assert.doesNotThrow(() =>
    requireCommandBody({
      command: "focus",
      args: {
        selector: "input"
      }
    })
  );

  assert.doesNotThrow(() =>
    requireCommandBody({
      command: "clear",
      args: {
        selector: "input"
      }
    })
  );
});

test("requireCommandBody rejects navigate with invalid URL", () => {
  assert.throws(
    () =>
      requireCommandBody({
        command: "navigate",
        args: { url: "file:///tmp/test.html" }
      }),
    (error) => error.code === "BAD_REQUEST" && /Only http and https URLs are supported/.test(error.message)
  );
});

test("requireCommandBody rejects select_option without selection strategy", () => {
  assert.throws(
    () =>
      requireCommandBody({
        command: "select_option",
        args: {
          selector: "select"
        }
      }),
    (error) =>
      error.code === "BAD_REQUEST" &&
      /requires one of args.value, args.label, or args.index/.test(error.message)
  );
});

test("requireCommandBody rejects non-integer tabId", () => {
  assert.throws(
    () =>
      requireCommandBody({
        command: "reload",
        tabId: "7"
      }),
    (error) => error.code === "BAD_REQUEST" && error.message === "tabId must be an integer"
  );
});
