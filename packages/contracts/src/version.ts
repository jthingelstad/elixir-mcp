/**
 * Contract version — docs/ENGINEERING.md: tool contract.
 * Semver over the domain contract, not a brittle wire interface: additive =
 * minor, corrections and response cleanup = patch, domain-model shifts =
 * major. serverInfo.version is
 * `${CONTRACT_VERSION}+tools.<fingerprint>` computed by the server.
 */
export const CONTRACT_VERSION = "9.0.0";
