// MCP 2026-07-28 carries its protocol and capability metadata on each request.
export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = ["2025-06-18", "2025-03-26"];
const supported = [MODERN_VERSION, ...LEGACY_VERSIONS];
const prefix = "io.modelcontextprotocol/";
const cacheable = new Set([
  "server/discover",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
]);

export function modernRequest(message, header) {
  return (
    header === MODERN_VERSION ||
    message?.params?._meta?.[prefix + "protocolVersion"] !== undefined ||
    message?.method === "server/discover"
  );
}

export function transportError(message, header, methodHeader, nameHeader) {
  if (!modernRequest(message, header)) return null;
  const meta = message?.params?._meta;
  const version = meta?.[prefix + "protocolVersion"];
  const invalid = (code, reason, data) => ({
    statusCode: 400,
    payload: {
      jsonrpc: "2.0",
      id: message?.id ?? null,
      error: { code, message: reason, ...(data && { data }) },
    },
  });
  if (
    typeof version !== "string" ||
    !meta?.[prefix + "clientCapabilities"] ||
    typeof meta[prefix + "clientCapabilities"] !== "object" ||
    Array.isArray(meta[prefix + "clientCapabilities"])
  )
    return invalid(
      -32602,
      "Expected per-request protocolVersion and clientCapabilities.",
    );
  const name =
    message.method === "resources/read"
      ? message.params?.uri
      : ["tools/call", "prompts/get"].includes(message.method)
        ? message.params?.name
        : null;
  const matchesName =
    typeof name === "string" &&
    (nameHeader === "=?base64?" + Buffer.from(name).toString("base64") + "?=" ||
      (nameHeader === name && !/^=\?base64\?.*\?=$/.test(name)));
  if (
    header !== version ||
    methodHeader !== message.method ||
    (["tools/call", "prompts/get", "resources/read"].includes(message.method) &&
      !matchesName)
  )
    return invalid(-32020, "Required MCP headers must match the request body.");
  if (version !== MODERN_VERSION)
    return invalid(-32022, "Unsupported protocol version.", {
      supported,
      requested: version,
    });
  return null;
}

export function discover(initial) {
  return {
    supportedVersions: supported,
    capabilities: initial.capabilities,
    instructions: initial.instructions,
    _meta: { ...initial._meta, [prefix + "serverInfo"]: initial.serverInfo },
  };
}

export function modernReply(reply, method) {
  const result = reply.payload?.result;
  if (result) {
    result.resultType = "complete";
    if (cacheable.has(method))
      Object.assign(result, { ttlMs: 60000, cacheScope: "private" });
  } else if (reply.payload?.error?.code === -32601 && method !== "tools/call")
    reply.statusCode = 404;
  return reply;
}
