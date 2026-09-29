/** Does a collector run a signed release? The pages' badge, from what
 *  the door stamped (0184) and what the hub named.
 *
 *  Naming verifies a release's signature before it writes a row, so a
 *  collector_release_history row is the signed SHA-256 of one
 *  platform's binary for one version. The collector reports no
 *  platform, and needs none: each platform's binary has its own hash,
 *  so a hash that equals ANY named hash for the reported version is
 *  that platform's signed binary. History, not collector_release, so a
 *  collector one release behind still verifies.
 *
 *  Self-reported: an operator can send any header (the collector's
 *  THREAT-MODEL.md). "signed" says an honest collector runs exactly a
 *  named build; it is not an attestation, and nothing gates on it. */

/** A select-list expression over a `gateway` aliased `g`. */
export const RELEASE_SIGNED_SQL = `exists (
  select 1 from collector_release_history h
  where h.version = g.last_seen_sha and h.sha256 = g.binary_sha256
) as release_signed`;

/** "signed", "dev_build", "unverified" or "mismatch". A dev build says
 *  so whatever it hashes to; no hash is an older client; a hash that is
 *  not the named one is a local build or something wrong, which Admin
 *  says loudly. */
export function signatureState(row) {
  if (row.last_seen_sha === "dev") return "dev_build";
  if (!row.binary_sha256) return "unverified";
  return row.release_signed ? "signed" : "mismatch";
}
