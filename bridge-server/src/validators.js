function buildError(code, message, details = null) {
  return {
    code,
    message,
    details
  };
}

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
}

module.exports = {
  buildError,
  requireCommandBody,
  requireToken
};

