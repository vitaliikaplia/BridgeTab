const crypto = require("crypto");

class SessionManager {
  constructor() {
    this.extensionSocket = null;
    this.extensionInfo = null;
    this.pending = new Map();
  }

  connectExtension(socket, info) {
    if (this.extensionSocket && this.extensionSocket !== socket) {
      this.extensionSocket.close(1000, "Replaced by a new session");
    }

    this.extensionSocket = socket;
    this.extensionInfo = {
      connectedAt: new Date().toISOString(),
      ...info
    };
  }

  disconnectExtension() {
    this.extensionSocket = null;
    this.extensionInfo = null;
    for (const [, deferred] of this.pending) {
      deferred.reject(new Error("No active bridge session"));
    }
    this.pending.clear();
  }

  hasSession() {
    return Boolean(this.extensionSocket && this.extensionSocket.readyState === 1);
  }

  getInfo() {
    return this.extensionInfo;
  }

  async sendCommand(commandEnvelope, timeoutMs = 8000) {
    if (!this.hasSession()) {
      throw new Error("No active bridge session");
    }

    const requestId = crypto.randomUUID();
    const payload = {
      ...commandEnvelope,
      requestId,
      type: "command"
    };

    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Command timed out"));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });

      this.extensionSocket.send(JSON.stringify(payload));
    });

    return response;
  }

  handleMessage(message) {
    if (message.type !== "command_result" || !message.requestId) {
      return false;
    }

    const deferred = this.pending.get(message.requestId);
    if (!deferred) {
      return false;
    }

    this.pending.delete(message.requestId);
    deferred.resolve(message);
    return true;
  }
}

module.exports = {
  SessionManager
};

