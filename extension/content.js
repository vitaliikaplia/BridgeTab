const INJECTED_FLAG = "__bridgetab_injected__";

function injectPageBridge() {
  if (window[INJECTED_FLAG]) {
    return;
  }

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
  window[INJECTED_FLAG] = true;
}

injectPageBridge();

window.addEventListener("BridgeTabPageLog", (event) => {
  chrome.runtime.sendMessage({
    type: "console_log",
    entry: event.detail
  });
});

function findElements(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function findElement(selector) {
  return document.querySelector(selector);
}

function isVisible(element) {
  if (!element) {
    return false;
  }
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity) > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isEnabled(element) {
  return !element.disabled && element.getAttribute("aria-disabled") !== "true";
}

function getElementText(element) {
  return (element.innerText || element.textContent || "").trim();
}

function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }
  element.value = value;
}

function dispatchTrustedLikeEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function serializeElement(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const attributes = {};
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value;
  }

  return {
    tag: element.tagName.toLowerCase(),
    text: getElementText(element),
    html: element.outerHTML,
    value: "value" in element ? element.value : "",
    visible: isVisible(element),
    enabled: isEnabled(element),
    checked: Boolean(element.checked),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    attributes,
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

function scrollIntoViewIfNeeded(element) {
  const rect = element.getBoundingClientRect();
  const verticallyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  const horizontallyVisible = rect.left >= 0 && rect.right <= window.innerWidth;
  if (!verticallyVisible || !horizontallyVisible) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  }
}

async function waitForSelector(selector, state, timeoutMs) {
  const start = performance.now();

  return new Promise((resolve) => {
    const evaluate = () => {
      const element = document.querySelector(selector);
      const exists = Boolean(element);
      const visible = exists ? isVisible(element) : false;
      const matches =
        (state === "present" && exists) ||
        (state === "visible" && visible) ||
        (state === "hidden" && exists && !visible) ||
        (state === "absent" && !exists);

      if (matches) {
        resolve({ success: true, elapsedMs: Math.round(performance.now() - start) });
        return true;
      }

      if (performance.now() - start >= timeoutMs) {
        resolve({ success: false, elapsedMs: Math.round(performance.now() - start) });
        return true;
      }

      return false;
    };

    if (evaluate()) {
      return;
    }

    const interval = window.setInterval(() => {
      if (evaluate()) {
        window.clearInterval(interval);
      }
    }, 100);
  });
}

async function handleCommand(command, args) {
  switch (command) {
    case "get_page_state":
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        },
        scroll: {
          x: window.scrollX,
          y: window.scrollY
        },
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      };
    case "query": {
      const elements = findElements(args.selector);
      return {
        exists: elements.length > 0,
        count: elements.length,
        first: serializeElement(elements[0]),
        all: args.all ? elements.map((element) => serializeElement(element)) : undefined
      };
    }
    case "click": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      scrollIntoViewIfNeeded(element);
      if (!isVisible(element)) {
        throw new Error("Element not visible");
      }
      element.click();
      return {
        success: true,
        clicked: true,
        elementSummary: serializeElement(element)
      };
    }
    case "type": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      element.focus();
      if (args.clearFirst && "value" in element) {
        setNativeValue(element, "");
        dispatchTrustedLikeEvents(element);
      }
      setNativeValue(element, args.text || "");
      dispatchTrustedLikeEvents(element);
      return {
        success: true,
        value: element.value
      };
    }
    case "press_keys": {
      const target = args.selector ? findElement(args.selector) : document.activeElement || document.body;
      if (!target) {
        throw new Error("Target element not found");
      }
      target.focus?.();
      const keys = String(args.keys || "")
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);
      const key = keys[keys.length - 1] || "";
      const modifiers = new Set(keys.slice(0, -1).map((item) => item.toLowerCase()));

      ["keydown", "keyup"].forEach((type) => {
        target.dispatchEvent(
          new KeyboardEvent(type, {
            key,
            bubbles: true,
            cancelable: true,
            metaKey: modifiers.has("meta"),
            ctrlKey: modifiers.has("ctrl") || modifiers.has("control"),
            altKey: modifiers.has("alt"),
            shiftKey: modifiers.has("shift")
          })
        );
      });

      return {
        success: true,
        keys: args.keys
      };
    }
    case "wait_for":
      return waitForSelector(args.selector, args.state || "visible", args.timeoutMs || 5000);
    case "scroll_into_view": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      scrollIntoViewIfNeeded(element);
      return {
        success: true,
        rect: serializeElement(element)?.rect || null
      };
    }
    default:
      throw new Error(`Unsupported content command: ${command}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleCommand(message.command, message.args || {})
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true;
});
