/** Private snapshot validation/import, never accepts or returns plaintext keys
 * or legacy session/token pairs. Unknown durable kinds require review. */
import { createHash } from "node:crypto";
import { createPostgresStore } from "./postgres.mjs";

const KINDS = new Set([
  "clan_size",
  "policy",
  "verdicts",
  "action_seq",
  "card",
  "action_log",
  "hold",
  "note",
  "recruit",
  "recruit_facts",
  "standings",
  "model_key",
  "schedule",
  "morning",
  "mailed",
  "sharing",
  "model_call",
  "awards",
  "awards_snapshot",
  "award",
  "social",
  "feedback",
  "place",
  "pref",
]);
const TEMPORARY = new Set(["session", "login"]);
const TOKEN_FIELDS = new Set([
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "verifier",
]);
function assertNoTokens(value) {
  if (typeof value === "string" && /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(value))
    throw new Error("clan import: plaintext model key refused");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (TOKEN_FIELDS.has(key))
      throw new Error("clan import: token field refused");
    assertNoTokens(child);
  }
}

export function inspectSnapshot(bytes, expectedSha256) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "") || sha256 !== expectedSha256)
    throw new Error("clan import: snapshot digest mismatch");
  let snapshot;
  try {
    snapshot = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("clan import: invalid snapshot JSON");
  }
  if (snapshot.version !== 1 || !Array.isArray(snapshot.items))
    throw new Error("clan import: invalid snapshot");
  const seen = new Set();
  const kinds = {};
  for (const item of snapshot.items) {
    if (!item || typeof item.pk !== "string" || !item.pk.includes("#"))
      throw new Error("clan import: invalid item key");
    const kind = item.pk.split("#", 1)[0];
    if (TEMPORARY.has(kind))
      throw new Error("clan import: temporary session/login refused");
    if (!KINDS.has(kind))
      throw new Error("clan import: unknown durable kind needs review");
    if (seen.has(item.pk)) throw new Error("clan import: duplicate item key");
    seen.add(item.pk);
    assertNoTokens(item);
    if (
      kind === "model_key" &&
      (!item.sealed ||
        item.sealed.v !== 1 ||
        typeof item.sealed.ct !== "string")
    )
      throw new Error("clan import: model key must remain sealed");
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return {
    sha256,
    items: snapshot.items,
    kinds,
    item_count: snapshot.items.length,
  };
}

export async function importSnapshot(
  db,
  bytes,
  expectedSha256,
  { apply = false } = {},
) {
  const { sha256, items, kinds, item_count } = inspectSnapshot(
    bytes,
    expectedSha256,
  );
  const receipt = { sha256, item_count, kinds };
  if (!apply) return { ...receipt, applied: false };
  await db.query("begin");
  try {
    await db.query(
      "select pg_advisory_xact_lock(hashtext('clan-state-import'))",
    );
    const prior = await db.query(
      "select 1 from clan_state_import where snapshot_sha256 = $1",
      [sha256],
    );
    if (prior.rowCount) {
      await db.query("commit");
      return { ...receipt, applied: false, already_imported: true };
    }
    const occupied = await db.query("select 1 from clan_state limit 1");
    if (occupied.rowCount)
      throw new Error("clan import: destination must be empty");
    const store = createPostgresStore(db);
    for (const item of items) await store.put(item);
    const count = (await db.query("select count(*)::int as n from clan_state"))
      .rows[0].n;
    if (count !== item_count)
      throw new Error("clan import: count verification failed");
    await db.query(
      "insert into clan_state_import (snapshot_sha256, item_count, kinds) values ($1, $2, $3::jsonb)",
      [sha256, item_count, JSON.stringify(kinds)],
    );
    await db.query("commit");
    return { ...receipt, applied: true };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
