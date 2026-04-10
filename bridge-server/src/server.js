const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { CommandRouter } = require("./command-router");
const { SessionManager } = require("./session-manager");
const { Logger } = require("./logger");
const { ScreenshotStore } = require("./screenshot-store");
const { buildError, requireCommandBody, requireToken } = require("./validators");

function createServer(config) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: "/ws" });

  const logger = new Logger(config.logPath);
  const screenshotStore = new ScreenshotStore(config.screenshotDir);
  const sessionManager = new SessionManager();
  const router = new CommandRouter({ sessionManager, screenshotStore, logger });

  app.use(express.json({ limit: "5mb" }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token");
    next();
  });

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      host: config.host,
      port: config.port,
      extensionConnected: sessionManager.hasSession(),
      connectedSession: sessionManager.getInfo()
    });
  });

  app.get("/tabs", async (req, res) => {
    try {
      requireToken(config.token, req.headers["x-bridge-token"]);
      const data = await router.dispatch({ command: "list_tabs" });
      res.json(data);
    } catch (error) {
      res.status(401).json({
        ok: false,
        error: error.code ? error : buildError("UNAUTHORIZED", error.message)
      });
    }
  });

  app.get("/logs", (req, res) => {
    try {
      requireToken(config.token, req.headers["x-bridge-token"]);
      res.json({
        success: true,
        entries: logger.list()
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error.code ? error : buildError("UNAUTHORIZED", error.message)
      });
    }
  });

  app.post("/connect", (req, res) => {
    try {
      requireToken(config.token, req.body?.token || req.headers["x-bridge-token"]);
      res.json({
        success: true,
        connected: sessionManager.hasSession(),
        session: sessionManager.getInfo(),
        wsUrl: `ws://${config.host}:${config.port}/ws`
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error.code ? error : buildError("UNAUTHORIZED", error.message)
      });
    }
  });

  app.post("/disconnect", (req, res) => {
    try {
      requireToken(config.token, req.body?.token || req.headers["x-bridge-token"]);
      if (sessionManager.extensionSocket) {
        sessionManager.extensionSocket.close(1000, "Disconnected by local command");
      }
      sessionManager.disconnectExtension();
      res.json({
        success: true,
        disconnected: true
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error.code ? error : buildError("UNAUTHORIZED", error.message)
      });
    }
  });

  app.post("/command", async (req, res) => {
    const providedToken = req.body?.token || req.headers["x-bridge-token"];

    try {
      requireToken(config.token, providedToken);
      requireCommandBody(req.body);
      const response = await router.dispatch(req.body);
      res.json(response);
    } catch (error) {
      const command = req.body?.command || null;
      const payload = error.code
        ? {
            success: false,
            command,
            tabId: req.body?.tabId || null,
            result: null,
            error
          }
        : router.formatError(error, command);

      res.status(error.code === "UNAUTHORIZED" ? 401 : 400).json(payload);
    }
  });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, `http://${config.host}:${config.port}`);
    const token = url.searchParams.get("token");
    const extensionId = url.searchParams.get("extensionId") || "unknown-extension";
    const browserLabel = url.searchParams.get("browserLabel") || "Chrome";

    try {
      requireToken(config.token, token);
    } catch (error) {
      socket.close(1008, "Unauthorized");
      return;
    }

    sessionManager.connectExtension(socket, { extensionId, browserLabel });
    logger.add({
      scope: "session",
      command: "connect",
      domain: null,
      tabId: null,
      success: true,
      error: null
    });

    socket.send(
      JSON.stringify({
        type: "connected",
        serverTime: new Date().toISOString()
      })
    );

    socket.on("message", (buffer) => {
      try {
        const message = JSON.parse(buffer.toString("utf8"));
        sessionManager.handleMessage(message);
      } catch (error) {
        logger.add({
          scope: "bridge",
          command: "invalid_message",
          domain: null,
          tabId: null,
          success: false,
          error: error.message
        });
      }
    });

    socket.on("close", () => {
      sessionManager.disconnectExtension();
      logger.add({
        scope: "session",
        command: "disconnect",
        domain: null,
        tabId: null,
        success: true,
        error: null
      });
    });
  });

  return {
    app,
    server,
    start() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => resolve());
      });
    }
  };
}

module.exports = {
  createServer
};

