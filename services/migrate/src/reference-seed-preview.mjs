import { createHash } from "node:crypto";
import { normalizeName } from "@elixir-mcp/contracts";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) =>
  createHash("sha256").update(encode(value)).digest("hex");
const ordered = (rows, key) =>
  [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

/** Compare every stored seed column. No caller SQL or business table reads. */
export async function referenceSeedPreview(db, spec) {
  const { roles, aliases, roles_version, source_commit } = spec;
  if (
    !Array.isArray(roles) ||
    !Array.isArray(aliases) ||
    roles.length > 1000 ||
    aliases.length > 1000
  )
    return { error: "invalid_reference_preview", reason: "row_bound" };
  const proposed = {
    roles: ordered(
      roles.map((r) => ({
        card_id: r.id,
        name: r.name,
        tier: typeof r.tier === "number" ? r.tier : null,
        family: r.family ?? null,
        at_cycle_cost: r.at_cycle_cost ?? null,
        needs_partner: r.needs_partner === true,
        pairs_with: r.pairs_with ? r.pairs_with : null,
        bait_tiers: r.bait_tiers ? r.bait_tiers : null,
        bait_unit: r.bait_unit === true,
        bridge_partner: r.bridge_partner === true,
        names_deck: r.names_deck === true,
        source: r.source,
        attested_at: r.attested_at ?? null,
        roles_version,
      })),
      "card_id",
    ),
    aliases: ordered(
      aliases.map((a) => ({
        alias: a.alias,
        alias_key: normalizeName(a.alias),
        cards: a.cards,
        family: a.family,
        source: a.source,
        attested_at: a.attested_at ?? null,
        roles_version,
      })),
      "alias",
    ),
  };
  await db.query("begin isolation level repeatable read read only");
  try {
    await db.query("set local statement_timeout = '5s'");
    await db.query("set local lock_timeout = '500ms'");
    await db.query("set local idle_in_transaction_session_timeout = '10s'");
    const { rows: rolesRows } = await db.query(
      "select to_jsonb(r) as row from card_role r order by card_id limit 1001",
    );
    const { rows: aliasesRows } = await db.query(
      "select to_jsonb(a) as row from deck_alias a order by alias limit 1001",
    );
    const { rows: versions } = await db.query(
      "select to_jsonb(v) as row from card_role_version v limit 2",
    );
    if (
      rolesRows.length > 1000 ||
      aliasesRows.length > 1000 ||
      versions.length !== 1
    )
      throw new Error("reference_preview_bound");
    const live = {
      roles: ordered(
        rolesRows.map((r) => r.row),
        "card_id",
      ),
      aliases: ordered(
        aliasesRows.map((r) => r.row),
        "alias",
      ),
    };
    const diffs = [];
    for (const [table, key] of [
      ["roles", "card_id"],
      ["aliases", "alias"],
    ]) {
      const actual = new Map(live[table].map((r) => [r[key], r]));
      const expected = new Map(proposed[table].map((r) => [r[key], r]));
      for (const id of new Set([...actual.keys(), ...expected.keys()])) {
        const a = actual.get(id),
          b = expected.get(id);
        if (encode(a) !== encode(b))
          diffs.push({
            table,
            key: id,
            fields: !a
              ? ["missing_live"]
              : !b
                ? ["extra_live"]
                : [...new Set([...Object.keys(a), ...Object.keys(b)])]
                    .filter((field) => encode(a[field]) !== encode(b[field]))
                    .sort(),
          });
      }
    }
    const version = versions[0].row;
    const versionCompatible =
      version.singleton === true &&
      version.roles_version === roles_version &&
      version.roles === roles.length &&
      version.aliases === aliases.length;
    const versionIdentical =
      versionCompatible && version.source_commit === source_commit;
    await db.query("commit");
    return {
      preview: true,
      readonly: true,
      identical: diffs.length === 0 && versionCompatible,
      roles: live.roles.length,
      aliases: live.aliases.length,
      live_sha256: digest(live),
      proposed_sha256: digest(proposed),
      version_identical: versionIdentical,
      version_compatible: versionCompatible,
      proposed_source_commit: source_commit,
      live_version: version,
      changed_rows: diffs.length,
      differences: diffs.slice(0, 20),
      differences_truncated: diffs.length > 20,
    };
  } catch {
    await db.query("rollback").catch(() => {});
    return { error: "reference_preview_failed" };
  }
}
