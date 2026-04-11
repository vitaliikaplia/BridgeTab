function buildError(code, message, details = null) {
  return {
    code,
    message,
    details
  };
}

const COMMAND_RULES = {
  ping: {},
  list_tabs: {},
  activate_tab: { requiresTabId: true },
  navigate: {
    requiredArgs: ["url"]
  },
  get_page_state: {},
  query: {
    requiredArgs: ["selector"]
  },
  click: {
    requiredArgs: ["selector"]
  },
  focus: {
    requiredArgs: ["selector"]
  },
  type: {
    requiredArgs: ["selector"],
    optionalArgs: ["text", "clearFirst"]
  },
  clear: {
    requiredArgs: ["selector"]
  },
  press_keys: {
    requiredArgs: ["keys"],
    optionalArgs: ["selector"]
  },
  wait_for: {
    requiredArgs: ["selector"],
    optionalArgs: ["state", "timeoutMs"]
  },
  scroll_into_view: {
    requiredArgs: ["selector"]
  },
  screenshot_page: {},
  screenshot_element: {
    requiredArgs: ["selector"]
  },
  get_console_logs: {},
  get_network_errors: {},
  get_local_storage: {
    optionalArgs: ["keys"]
  },
  hover: {
    requiredArgs: ["selector"]
  },
  select_option: {
    requiredArgs: ["selector"],
    optionalArgs: ["value", "label", "index"]
  },
  reload: {}
};

function requireToken(expectedToken, providedToken) {
  if (!providedToken || providedToken !== expectedToken) {
    throw buildError("UNAUTHORIZED", "Invalid session token");
  }
}

function requireCommandBody(body) {
  if (!body || typeof body !== "object") {
    throw buildError("BAD_REQUEST", "Command body is required");
  }

  if (typeof body.command !== "string" || !body.command.trim()) {
    throw buildError("BAD_REQUEST", "Command name is required");
  }

  const command = body.command.trim();
  const rule = COMMAND_RULES[command];
  if (!rule) {
    throw buildError("BAD_REQUEST", `Unsupported command: ${command}`, {
      supportedCommands: Object.keys(COMMAND_RULES)
    });
  }

  if (body.tabId != null && !Number.isInteger(body.tabId)) {
    throw buildError("BAD_REQUEST", "tabId must be an integer");
  }

  if (body.timeoutMs != null && (!Number.isFinite(body.timeoutMs) || body.timeoutMs <= 0)) {
    throw buildError("BAD_REQUEST", "timeoutMs must be a positive number");
  }

  const args = body.args == null ? {} : body.args;
  if (body.args != null && (typeof body.args !== "object" || Array.isArray(body.args))) {
    throw buildError("BAD_REQUEST", "args must be an object");
  }

  if (rule.requiresTabId && body.tabId == null) {
    throw buildError("BAD_REQUEST", `Command ${command} requires tabId`);
  }

  for (const argName of rule.requiredArgs || []) {
    const value = args[argName];
    if (value == null || (typeof value === "string" && !value.trim())) {
      throw buildError("BAD_REQUEST", `Command ${command} requires args.${argName}`);
    }
  }

  if (command === "select_option" && args.value == null && args.label == null && args.index == null) {
    throw buildError(
      "BAD_REQUEST",
      "Command select_option requires one of args.value, args.label, or args.index"
    );
  }

  if (command === "navigate") {
    try {
      const parsed = new URL(args.url);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error("Only http and https URLs are supported");
      }
    } catch (error) {
      throw buildError("BAD_REQUEST", error.message === "Invalid URL" ? "args.url must be a valid URL" : error.message);
    }
  }
}

module.exports = {
  buildError,
  COMMAND_RULES,
  requireCommandBody,
  requireToken
};
