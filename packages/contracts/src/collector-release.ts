/**
 * The collector release key: the public half of the ed25519 key that
 * signs every elixir-mcp-collector release's SHA256SUMS. One copy for
 * this repository. The naming script verifies signatures with it, the
 * Collectors pages draw its fingerprint, and a test holds the operators
 * page to it. The collector compiles the same line in
 * (internal/v2/releasekey.go) and publishes it in its SECURITY.md.
 *
 * Rotation (the collector's SECURITY.md) adds the new key beside the
 * old one here, as the collector does, and removes the old one later.
 */
export interface CollectorReleaseKey {
  /** `ssh-ed25519 <base64 blob>`, as ssh-keygen writes it, no comment. */
  line: string;
  /** The OpenSSH SHA256 fingerprint of `line`; a test recomputes it. */
  fingerprint: string;
}

/** The signer identity and signature namespace releases use. */
export const COLLECTOR_RELEASE_SIGNER = "elixir-mcp-collector-release";

export const COLLECTOR_RELEASE_KEYS: readonly CollectorReleaseKey[] = [
  {
    line: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFvN1mZGTcFXSGnIXf8h33cxAhvrHPYn80BO5FkELh28",
    fingerprint: "SHA256:mktajl7kjMESYLyiY34rRu9hLTL6+EJS3I6aa/sGqeU",
  },
];
