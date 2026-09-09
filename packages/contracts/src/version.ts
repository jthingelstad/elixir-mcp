/**
 * Contract version — docs/ENGINEERING.md: tool contract.
 * Semver over the tool contract, not the code: additive = minor,
 * breaking = major with a deprecation window. serverInfo.version is
 * `${CONTRACT_VERSION}+tools.<fingerprint>` computed by the server.
 */
export const CONTRACT_VERSION = "0.42.0";
