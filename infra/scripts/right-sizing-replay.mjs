/** Pure preparation for retained-only battle-log replay. No S3 or DB writes. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { observerEvidence } from "./right-sizing-observers.mjs";
import { payloadHash } from "../../packages/ingest/src/hash.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** All entries receive an explicit disposition. Unknown provenance is kept.
 * Original compressed bytes and the complete identity map must match the
 * approved evidence. Only whole battle entries are filtered, never players,
 * decks, duel rounds or fields. The new key keeps the original fetch partition.
 */
export function prepareBattlelogRewrite({
  item,
  compressed,
  evidence,
  decisions,
}) {
  const actual = observerEvidence(item, compressed);
  if (!isDeepStrictEqual(actual, evidence))
    throw new Error("battle-log evidence changed");
  if (!Array.isArray(decisions)) throw new Error("missing battle dispositions");
  const states = new Map();
  for (const d of decisions) {
    if (
      !/^[a-f0-9]{64}$/.test(d.battle_id ?? "") ||
      !["removable", "retained", "unresolved"].includes(d.disposition) ||
      states.has(d.battle_id)
    )
      throw new Error("invalid or duplicate battle disposition");
    states.set(d.battle_id, d.disposition);
  }
  const ids = new Set(actual.battles.map((b) => b.battle_id));
  if (states.size !== ids.size || [...ids].some((id) => !states.has(id)))
    throw new Error("battle dispositions do not cover exactly this payload");
  const payload = JSON.parse(
    gunzipSync(compressed, { maxOutputLength: 128_000_000 }).toString("utf8"),
  );
  const kept = payload.filter(
    (_, i) => states.get(actual.battles[i].battle_id) !== "removable",
  );
  if (kept.length === 0 || kept.length === payload.length)
    throw new Error("rewrite requires both retained and removable entries");
  const hash = payloadHash(kept);
  const key = item.key.replace(
    /-[a-f0-9]{16}\.json\.gz$/,
    `-${hash.slice(0, 16)}.json.gz`,
  );
  if (key === item.key) throw new Error("derived archive key collision");
  const bytes = gzipSync(JSON.stringify(kept));
  const derived = observerEvidence(
    { ...item, key, version_id: "prepared", bytes: bytes.length },
    bytes,
  );
  if (
    derived.payload_hash !== hash ||
    derived.battles.some((b) => states.get(b.battle_id) === "removable")
  )
    throw new Error("derived replay contains a removed battle");
  return {
    bytes,
    receipt: {
      original: actual,
      replacement: {
        key,
        payload_hash: hash,
        compressed_sha256: sha(bytes),
        bytes: bytes.length,
        battles: derived.battles,
      },
      retained_entries: kept.length,
      removed_entries: payload.length - kept.length,
      unresolved_entries: actual.battles.filter(
        (b) => states.get(b.battle_id) === "unresolved",
      ).length,
    },
  };
}

/** Refuse an existing destination with different content before publishing.
 * Content-addressed keys identify JSON semantics, not a gzip compressor.
 */
export function verifyBattlelogReplacement(receipt, compressed) {
  const expected = receipt.replacement;
  const actual = observerEvidence(
    {
      kind: "version",
      key: expected.key,
      version_id: "verified",
      bytes: compressed.length,
    },
    compressed,
  );
  if (
    actual.payload_hash !== expected.payload_hash ||
    !isDeepStrictEqual(actual.battles, expected.battles)
  )
    throw new Error("replacement replay differs");
  return {
    payload_hash: actual.payload_hash,
    compressed_sha256: actual.compressed_sha256,
  };
}
