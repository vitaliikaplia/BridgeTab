const { buildError } = require("./validators");

class CommandRouter {
  constructor({ sessionManager, screenshotStore, logger }) {
    this.sessionManager = sessionManager;
    this.screenshotStore = screenshotStore;
    this.logger = logger;
  }

  async dispatch(commandBody) {
    const timeoutMs = commandBody.timeoutMs || 10000;
    const response = await this.sessionManager.sendCommand(commandBody, timeoutMs);

    const isObjectResult =
      response.result && typeof response.result === "object" && !Array.isArray(response.result);
    const result = Array.isArray(response.result)
      ? [...response.result]
      : isObjectResult
        ? { ...response.result }
        : response.result;

    if (isObjectResult && result.screenshotBase64) {
      result.path = this.screenshotStore.savePng(
        result.screenshotBase64,
        commandBody.command.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
      );
      delete result.screenshotBase64;
    }

    this.logger.add({
      scope: "command",
      command: commandBody.command,
      domain: result.url || commandBody.url || null,
      tabId: response.tabId || commandBody.tabId || null,
      success: response.success,
      error: response.error ? response.error.message : null
    });

    return {
      success: response.success,
      command: commandBody.command,
      tabId: response.tabId || commandBody.tabId || null,
      result,
      error: response.error || null
    };
  }

  formatError(error, command) {
    return {
      success: false,
      command,
      tabId: null,
      result: null,
      error: buildError("COMMAND_FAILED", error.message)
    };
  }
}

module.exports = {
  CommandRouter
};
