(function bridgeTabContentScript() {
if (window.__bridgetab_content_script_loaded__) {
  return;
}
window.__bridgetab_content_script_loaded__ = true;

const INJECTED_FLAG = "__bridgetab_injected__";
const ACTIVITY_OVERLAY_ID = "__bridgetab_activity_overlay__";
const ACTIVITY_MIN_VISIBLE_MS = 1100;
const ACTIVITY_FADE_OUT_MS = 260;
const ACTIVITY_OVERLAY_STYLE = `
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  opacity: 0;
  visibility: hidden;
  box-shadow:
    inset 0 0 0 2px rgba(42, 196, 134, 0.38),
    inset 0 0 64px rgba(54, 233, 160, 0.28),
    inset 0 0 180px rgba(22, 145, 98, 0.2),
    inset 0 0 320px rgba(10, 88, 58, 0.12);
  background:
    radial-gradient(circle at top, rgba(90, 244, 176, 0.12), transparent 44%),
    radial-gradient(circle at bottom, rgba(36, 182, 124, 0.1), transparent 42%);
  transition:
    opacity ${ACTIVITY_FADE_OUT_MS}ms ease,
    visibility 0ms linear ${ACTIVITY_FADE_OUT_MS}ms;
  transform: translateZ(0);
`;
const ACTIVITY_OVERLAY_ACTIVE_STYLE = `
  opacity: 1;
  visibility: visible;
  transition:
    opacity 140ms ease,
    visibility 0ms linear 0ms;
`;
const SCROLL_SETTLE_MS = 260;

const activityOverlayState = {
  activeCount: 0,
  visibleSince: 0,
  hideTimer: null
};

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

function ensureActivityOverlay() {
  let overlay = document.getElementById(ACTIVITY_OVERLAY_ID);
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.id = ACTIVITY_OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = ACTIVITY_OVERLAY_STYLE;
  (document.documentElement || document.body || document.head).appendChild(overlay);
  return overlay;
}

function clearActivityHideTimer() {
  if (activityOverlayState.hideTimer) {
    clearTimeout(activityOverlayState.hideTimer);
    activityOverlayState.hideTimer = null;
  }
}

function showActivityOverlay() {
  const overlay = ensureActivityOverlay();
  clearActivityHideTimer();
  activityOverlayState.activeCount += 1;

  if (activityOverlayState.activeCount === 1) {
    activityOverlayState.visibleSince = Date.now();
  }

  overlay.style.cssText = `${ACTIVITY_OVERLAY_STYLE}${ACTIVITY_OVERLAY_ACTIVE_STYLE}`;

  return {
    activeCount: activityOverlayState.activeCount,
    visibleSince: activityOverlayState.visibleSince
  };
}

function hideActivityOverlay() {
  const overlay = ensureActivityOverlay();
  activityOverlayState.activeCount = Math.max(0, activityOverlayState.activeCount - 1);

  if (activityOverlayState.activeCount > 0) {
    return {
      activeCount: activityOverlayState.activeCount,
      visible: true
    };
  }

  const elapsed = Date.now() - activityOverlayState.visibleSince;
  const remainingVisibleMs = Math.max(0, ACTIVITY_MIN_VISIBLE_MS - elapsed);
  clearActivityHideTimer();

  activityOverlayState.hideTimer = setTimeout(() => {
    overlay.style.cssText = ACTIVITY_OVERLAY_STYLE;
    activityOverlayState.hideTimer = null;
  }, remainingVisibleMs);

  return {
    activeCount: activityOverlayState.activeCount,
    visible: remainingVisibleMs > 0
  };
}

window.addEventListener("BridgeTabPageLog", (event) => {
  chrome.runtime.sendMessage({
    type: "console_log",
    entry: event.detail
  });
});

function findElements(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function viewportDistance(element) {
  const rect = element.getBoundingClientRect();
  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  const elementCenterX = rect.left + rect.width / 2;
  const elementCenterY = rect.top + rect.height / 2;
  return Math.abs(viewportCenterX - elementCenterX) + Math.abs(viewportCenterY - elementCenterY);
}

function findElement(selector, options = {}) {
  const elements = findElements(selector).filter((element) => element?.isConnected);
  if (!elements.length) {
    return null;
  }

  const scored = elements.map((element, index) => ({
    element,
    index,
    visible: isVisible(element),
    inViewport: isInViewport(element),
    enabled: isEnabled(element),
    distance: viewportDistance(element)
  }));

  scored.sort((a, b) => {
    if (a.visible !== b.visible) {
      return a.visible ? -1 : 1;
    }
    if (a.inViewport !== b.inViewport) {
      return a.inViewport ? -1 : 1;
    }
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.index - b.index;
  });

  return scored[0].element;
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

function getValueDescriptor(element) {
  if (element instanceof HTMLInputElement) {
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  }
  if (element instanceof HTMLTextAreaElement) {
    return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  }
  if (element instanceof HTMLSelectElement) {
    return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  }

  let prototype = Object.getPrototypeOf(element);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      return descriptor;
    }
    prototype = Object.getPrototypeOf(prototype);
  }

  return null;
}

function getLiveValue(element) {
  return "value" in element ? element.value : "";
}

function getAttributeValue(element) {
  return element.getAttribute?.("value") ?? null;
}

function setNativeValue(element, value) {
  const descriptor = getValueDescriptor(element);
  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }
  element.value = value;
}

function dispatchInputSequence(element, { previousValue = "", nextValue = "", commit = true } = {}) {
  const inputType = nextValue.length >= previousValue.length ? "insertText" : "deleteContentBackward";
  const data = nextValue === previousValue ? null : nextValue;

  element.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data,
      inputType
    })
  );
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data,
      inputType
    })
  );

  if (commit) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function dispatchKeyboardEchoEvents(element, nextValue) {
  const lastCharacter = nextValue ? nextValue[nextValue.length - 1] : "Backspace";
  ["keydown", "keypress", "keyup"].forEach((type) => {
    element.dispatchEvent(
      new KeyboardEvent(type, {
        key: lastCharacter,
        bubbles: true,
        cancelable: true
      })
    );
  });
}

function blurWithEvents(element) {
  if (document.activeElement !== element) {
    return;
  }

  element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  element.blur?.();
}

async function waitForValueCommit(selector, expectedValue, timeoutMs = 1600, stableForMs = 220) {
  const start = performance.now();
  let lastSnapshot = null;
  let firstMatchAt = null;

  while (performance.now() - start <= timeoutMs) {
    const element = findElement(selector);
    if (element) {
      lastSnapshot = serializeElement(element);
      if (getLiveValue(element) === expectedValue) {
        if (firstMatchAt == null) {
          firstMatchAt = performance.now();
        }
        if (performance.now() - firstMatchAt >= stableForMs) {
          return {
            committed: true,
            element,
            snapshot: lastSnapshot,
            elapsedMs: Math.round(performance.now() - start)
          };
        }
      } else {
        firstMatchAt = null;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    committed: false,
    element: findElement(selector),
    snapshot: lastSnapshot,
    elapsedMs: Math.round(performance.now() - start)
  };
}

async function commitTextEntry(selector, nextValue, { clearFirst = false } = {}) {
  const strategies = [
    { blurAfter: false, keyboardEcho: false, label: "direct_input" },
    { blurAfter: true, keyboardEcho: true, label: "blur_commit" }
  ];

  let beforeSnapshot = null;
  let lastCommitState = null;

  for (const strategy of strategies) {
    const element = findElement(selector);
    if (!element) {
      throw new Error("Element not found");
    }
    if (!("value" in element)) {
      throw new Error("Target element does not support text input");
    }

    await scrollIntoViewIfNeeded(element);
    element.focus?.();

    const beforeValue = getLiveValue(element);
    beforeSnapshot = {
      valueProperty: beforeValue,
      valueAttribute: getAttributeValue(element)
    };

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const selectionEnd = beforeValue.length;
      try {
        element.setSelectionRange?.(0, selectionEnd);
      } catch (_error) {
        // Some input types do not support programmatic selection ranges.
      }
    }

    if (clearFirst && beforeValue) {
      setNativeValue(element, "");
      dispatchInputSequence(element, {
        previousValue: beforeValue,
        nextValue: "",
        commit: false
      });
    }

    setNativeValue(element, nextValue);
    dispatchInputSequence(element, {
      previousValue: beforeValue,
      nextValue,
      commit: true
    });

    if (strategy.keyboardEcho) {
      dispatchKeyboardEchoEvents(element, nextValue);
    }
    if (strategy.blurAfter) {
      blurWithEvents(element);
    }

    await nextFrame();
    await nextFrame();

    lastCommitState = await waitForValueCommit(selector, nextValue);
    if (lastCommitState.committed) {
      return {
        strategy: strategy.label,
        beforeSnapshot,
        commitState: lastCommitState
      };
    }
  }

  return {
    strategy: strategies[strategies.length - 1].label,
    beforeSnapshot,
    commitState: lastCommitState
  };
}

async function applyTextValue(selector, value, { clearFirst = false } = {}) {
  const nextValue = clearFirst ? String(value || "") : String(value ?? "");
  const { strategy, beforeSnapshot, commitState } = await commitTextEntry(selector, nextValue, {
    clearFirst
  });
  const activeElement = document.activeElement;
  const element = commitState.element || findElement(selector);

  return {
    success: true,
    committed: commitState.committed,
    requestedValue: nextValue,
    value: commitState.snapshot?.valueProperty ?? getLiveValue(commitState.element || element),
    debug: {
      strategy,
      before: beforeSnapshot,
      after: {
        valueProperty: commitState.snapshot?.valueProperty ?? getLiveValue(commitState.element || element),
        valueAttribute: commitState.snapshot?.valueAttribute ?? getAttributeValue(commitState.element || element),
        activeElementTag: activeElement?.tagName?.toLowerCase() || null,
        activeElementName: activeElement?.getAttribute?.("name") || null,
        activeMatchesTarget: Boolean(commitState.element && activeElement === commitState.element),
        committed: commitState.committed,
        elapsedMs: commitState.elapsedMs
      },
      events: ["beforeinput", "input", "change", "keydown", "keypress", "keyup", "blur", "focusout"]
    }
  };
}

function dispatchMouseEvent(element, type) {
  element.dispatchEvent(
    new MouseEvent(type, {
      view: window,
      bubbles: true,
      cancelable: true
    })
  );
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
    value: getLiveValue(element),
    valueProperty: getLiveValue(element),
    valueAttribute: getAttributeValue(element),
    visible: isVisible(element),
    enabled: isEnabled(element),
    checked: Boolean(element.checked),
    active: document.activeElement === element,
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

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollIntoViewIfNeeded(element) {
  const performScroll = async () => {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    await wait(SCROLL_SETTLE_MS);
    await nextFrame();
  };

  await performScroll();

  let rect = element.getBoundingClientRect();
  const verticallyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  const horizontallyVisible = rect.left >= 0 && rect.right <= window.innerWidth;

  if (!verticallyVisible || !horizontallyVisible) {
    const targetY = window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2;
    const targetX = window.scrollX + rect.left - window.innerWidth / 2 + rect.width / 2;
    window.scrollTo({
      top: Math.max(0, targetY),
      left: Math.max(0, targetX),
      behavior: "smooth"
    });
    await wait(SCROLL_SETTLE_MS);
    await nextFrame();
    rect = element.getBoundingClientRect();
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
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
    case "__activity_start":
      return {
        success: true,
        overlay: showActivityOverlay()
      };
    case "__activity_end":
      return {
        success: true,
        overlay: hideActivityOverlay()
      };
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
      const bestElement = findElement(args.selector);
      return {
        exists: elements.length > 0,
        count: elements.length,
        first: serializeElement(bestElement || elements[0]),
        all: args.all ? elements.map((element) => serializeElement(element)) : undefined
      };
    }
    case "click": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      await scrollIntoViewIfNeeded(element);
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
    case "focus": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      await scrollIntoViewIfNeeded(element);
      element.focus?.();
      return {
        success: true,
        focused: document.activeElement === element,
        elementSummary: serializeElement(element)
      };
    }
    case "hover": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      await scrollIntoViewIfNeeded(element);
      if (!isVisible(element)) {
        throw new Error("Element not visible");
      }
      dispatchMouseEvent(element, "mouseenter");
      dispatchMouseEvent(element, "mouseover");
      dispatchMouseEvent(element, "mousemove");
      return {
        success: true,
        hovered: true,
        elementSummary: serializeElement(element)
      };
    }
    case "type": {
      return applyTextValue(args.selector, args.text || "", {
        clearFirst: Boolean(args.clearFirst)
      });
    }
    case "clear": {
      const { strategy, beforeSnapshot, commitState } = await commitTextEntry(args.selector, "", {
        clearFirst: true
      });
      const element = commitState.element || findElement(args.selector);
      return {
        success: true,
        committed: commitState.committed,
        value: commitState.snapshot?.valueProperty ?? "",
        debug: {
          strategy,
          before: beforeSnapshot,
          after: {
            valueProperty: commitState.snapshot?.valueProperty ?? "",
            valueAttribute: commitState.snapshot?.valueAttribute ?? getAttributeValue(commitState.element || element),
            committed: commitState.committed,
            elapsedMs: commitState.elapsedMs
          },
          events: ["beforeinput", "input", "change", "keydown", "keypress", "keyup", "blur", "focusout"]
        }
      };
    }
    case "press_keys": {
      const target = args.selector ? findElement(args.selector) : document.activeElement || document.body;
      if (!target) {
        throw new Error("Target element not found");
      }
      if (args.selector) {
        await scrollIntoViewIfNeeded(target);
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
    case "select_option": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error("Target element is not a select");
      }

      let option = null;
      if (args.value != null) {
        option = Array.from(element.options).find((item) => item.value === String(args.value));
      }
      if (!option && args.label != null) {
        option = Array.from(element.options).find((item) => getElementText(item) === String(args.label).trim());
      }
      if (!option && args.index != null) {
        option = element.options[Number(args.index)] || null;
      }
      if (!option) {
        throw new Error("Option not found");
      }

      await scrollIntoViewIfNeeded(element);
      element.focus();
      const previousValue = getLiveValue(element);
      setNativeValue(element, option.value);
      option.selected = true;
      dispatchInputSequence(element, {
        previousValue,
        nextValue: option.value,
        commit: true
      });

      return {
        success: true,
        value: element.value,
        selectedOption: {
          value: option.value,
          label: getElementText(option),
          index: option.index
        }
      };
    }
    case "wait_for":
      return waitForSelector(args.selector, args.state || "visible", args.timeoutMs || 5000);
    case "scroll_into_view": {
      const element = findElement(args.selector);
      if (!element) {
        throw new Error("Element not found");
      }
      const rect = await scrollIntoViewIfNeeded(element);
      return {
        success: true,
        rect
      };
    }
    case "get_local_storage": {
      const requestedKeys = Array.isArray(args.keys)
        ? args.keys.map((key) => String(key))
        : null;
      const storage = {};

      if (requestedKeys?.length) {
        for (const key of requestedKeys) {
          storage[key] = window.localStorage.getItem(key);
        }
      } else {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key != null) {
            storage[key] = window.localStorage.getItem(key);
          }
        }
      }

      return {
        origin: window.location.origin,
        count: Object.keys(storage).length,
        storage
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
})();
