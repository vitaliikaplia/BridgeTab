(function pageBridgeBootstrap() {
  if (window.__bridgetab_page_bridge__) {
    return;
  }
  window.__bridgetab_page_bridge__ = true;

  function emit(level, message, source) {
    window.dispatchEvent(
      new CustomEvent("BridgeTabPageLog", {
        detail: {
          level,
          message,
          timestamp: new Date().toISOString(),
          source
        }
      })
    );
  }

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args) => {
    emit("error", args.map(String).join(" "), "console.error");
    originalError(...args);
  };

  console.warn = (...args) => {
    emit("warn", args.map(String).join(" "), "console.warn");
    originalWarn(...args);
  };

  window.addEventListener("error", (event) => {
    emit("error", event.message || "Unknown error", event.filename || "window.onerror");
  });

  window.addEventListener("unhandledrejection", (event) => {
    emit("error", String(event.reason || "Unhandled promise rejection"), "unhandledrejection");
  });
})();

