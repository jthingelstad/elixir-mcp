// The quick-create HTTP APIs own API Gateway-managed $default stages, so
// CloudFormation cannot declare their stage settings. Keep the small,
// evidence-sized direct control here and apply it with
// configure-api-throttles.mjs after measuring production traffic.
export const API_THROTTLES = Object.freeze([
  Object.freeze({
    apiName: "elixir-mcp-site-api",
    rateLimit: 20,
    burstLimit: 40,
  }),
  Object.freeze({
    apiName: "elixir-mcp-mcp-api",
    rateLimit: 50,
    burstLimit: 100,
  }),
]);
