import pg from "pg";
import {
  MEMBERS_SQL,
  FORMER_MEMBERS_SQL,
  participationQueries,
} from "@elixir-mcp/record/participation-sql";
import { typesForModeGroup } from "@elixir-mcp/contracts";

const READS = new Set([
  "battles_by_week",
  "former_battles_by_week",
  "donations_by_week",
  "former_donations_by_week",
  "war_weeks",
  "war_participation",
]);

// EXPLAIN conditions embed bound player/clan values. Return only structural
// fields and estimates, never conditions, outputs, SQL or parameters.
function planShape(top) {
  const nodes = [];
  const walk = (node) => {
    if (!node) return;
    nodes.push({
      node: node["Node Type"],
      relation: node["Relation Name"] ?? null,
      index: node["Index Name"] ?? null,
      rows: node["Plan Rows"] ?? null,
      total_cost: node["Total Cost"] ?? null,
      width: node["Plan Width"] ?? null,
    });
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(top?.Plan);
  return nodes;
}

/** One or two canonical participation plans, without executing aggregates.
 * Membership lists are the only data reads needed to bind the plans. */
export async function participationPlan(databaseUrl, spec = {}, client = null) {
  const names = spec.queries ?? ["battles_by_week"];
  const weeks = Number(spec.weeks ?? 8);
  if (
    !Array.isArray(names) ||
    names.length < 1 ||
    names.length > 2 ||
    names.some((name) => !READS.has(name)) ||
    new Set(names).size !== names.length
  )
    return { error: "one_or_two_known_participation_queries_required" };
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8)
    return { error: "weeks_must_be_1_to_8" };
  const clanTag = String(spec.clan_tag ?? "").toUpperCase();
  if (!/^#[0289PYLQGRJCUV]{3,12}$/.test(clanTag))
    return { error: "clan_tag_required" };
  const db =
    client ??
    new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
  try {
    await db.connect();
    await db.query("set default_transaction_read_only = on");
    await db.query("set statement_timeout = 5000");
    await db.query("set lock_timeout = 500");
    const now = new Date();
    const day = now.getUTCDay() || 7;
    const from = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - day + 1,
      ) -
        (weeks - 1) * 7 * 86400_000,
    );
    const tags = (await db.query(MEMBERS_SQL, [clanTag])).rows.map(
      (row) => row.player_tag,
    );
    const needsFormer =
      names.some((name) => name.startsWith("former_")) ||
      names.includes("war_participation");
    const formerTags = needsFormer
      ? (await db.query(FORMER_MEMBERS_SQL, [clanTag, from])).rows.map(
          (row) => row.player_tag,
        )
      : [];
    const canonical = participationQueries({
      clanTag,
      tags,
      formerTags,
      from,
      rankedTypes: typesForModeGroup("ranked"),
    });
    const plans = [];
    for (const name of names) {
      const query = canonical.find((item) => item.name === name);
      const started = Date.now();
      const result = await db.query(
        `explain (format json) ${query.text}`,
        query.values,
      );
      plans.push({
        name,
        planning_ms: Date.now() - started,
        nodes: planShape(result.rows[0]?.["QUERY PLAN"]?.[0]),
      });
    }
    const indexes = (
      await db.query(
        `select indexname, indexdef from pg_indexes where schemaname = 'public'
       and indexname = any($1::text[]) order by indexname`,
        [
          [
            "battle_participant_player_time_cover",
            "battle_participant_clan_time",
            "battle_participant_pkey",
            "battle_pkey",
          ],
        ],
      )
    ).rows;
    const visibility = (
      await db.query(
        `select relname, relpages, relallvisible from pg_class
       where oid in ('battle'::regclass, 'battle_participant'::regclass) order by relname`,
      )
    ).rows;
    const settings = (
      await db.query(
        `select name, setting from pg_settings where name = any($1::text[]) order by name`,
        [
          [
            "work_mem",
            "random_page_cost",
            "effective_cache_size",
            "enable_bitmapscan",
            "enable_indexonlyscan",
            "enable_seqscan",
            "jit",
          ],
        ],
      )
    ).rows;
    return { analyze: false, weeks, plans, indexes, visibility, settings };
  } finally {
    await db.end();
  }
}
