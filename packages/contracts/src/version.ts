/**
 * The MCP contract version — docs/ENGINEERING.md: tool contract.
 * Semver over the domain contract its agents read, not a brittle wire
 * interface: additive = minor, corrections and response cleanup = patch,
 * domain-model shifts = major. MCP only: the JSON API is versioned by its
 * OpenAPI document's info.version, on ordinary semver (a removed field is
 * a major), because its callers are programs. serverInfo.version is
 * `${CONTRACT_VERSION}+tools.<fingerprint>` computed by the server.
 */
export const CONTRACT_VERSION = "9.1.0";
