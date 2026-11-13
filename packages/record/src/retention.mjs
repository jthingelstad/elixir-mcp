/**
 * How long Elixir keeps what it records: one declared list, the daily
 * trim that applies it, and the dry run that counts what the trim would
 * take. Jamie, 2026-11-13: "assume a 1 year data retention", and
 * "Operational logs i would keep for 28 days" (DECISIONS.md, Retention).
 *
 * Every table in the schema is in exactly one of four lists, and
 * services/jobs/test/retention.test.mjs fails on a table in none:
 *
 *  - TRIMMED: time-keyed history this module deletes past its window
 *    (one year, or 28 days for an operational log). An entry with
 *    `held` is declared but not run: the reason says what still reads
 *    rows older than the window. The dry run counts it all the same.
 *  - OWN_TRIMS: time-keyed rows another sweep already deletes on a
 *    shorter clock, named here with where that sweep lives.
 *  - CHILDREN: rows that go with a trimmed parent (a battle's
 *    participants, a war week's attendance), never by their own age.
 *  - KEPT: current state, settings, identities and catalogs: rows that
 *    are not history over time, each with its reason.
 *
 * The trim deletes in small batches, each its own transaction under a
 * statement and lock timeout, with a cap on batches per table and per
 * run and a wall-clock budget; what is left goes the next day. Batches
 * select their rows through the time column's index where one exists.
 */

import {
  ATTESTED_FACT_RETENTION,
  ATTESTED_FACT_TABLE,
} from "./attested-facts.mjs";

const YEAR = "1 year";
const DAYS_28 = "28 days";

/** Rows per batch, batches per table per run, batches per run. */
export const TRIM_LIMITS = Object.freeze({
  batchRows: 2000,
  battleBatch: 200,
  tableStatements: 50,
  runStatements: 300,
  budgetMs: 120_000,
});

const plain = (table, column, window, extra = "") => ({
  table,
  column,
  window,
  extra,
});

/**
 * Trimmed, in the order the trim runs: a child before its parent, so a
 * parent's own batch finds no child left to block it.
 *
 * `extra` narrows which old rows go (an open membership, an unresolved
 * feedback item, a claim still open stay whatever their age).
 * `kind: "battle" | "war_week" | "game_event" | "oauth_family" |
 * "api_receipt"` names a delete that takes rows elsewhere with it.
 */
export const TRIMMED = Object.freeze([
  // Operational logs, 28 days.
  {
    ...plain("mcp_call_audit", "created_at", DAYS_28),
    note: "the call log; every reader looks back 14 days or less",
  },
  {
    ...plain("capture_audit", "fetched_at", DAYS_28),
    note: "a poll's gap flag; the product reads the last three days, and its row goes before its receipt",
  },
  {
    ...plain("api_receipt", "fetched_at", DAYS_28),
    kind: "api_receipt",
    held: "role history starts at the first recorded roster read (participation-sql.mjs role_history_since), war award absence reads the before-start and after-finish reads (war-membership.mjs), and game_events derives which days the calendar was read from them; each would shrink to 28 days",
  },

  // The record, one year.
  {
    ...plain("battle", "battle_time", YEAR),
    kind: "battle",
    note: "takes its player_event rows, rounds, participants and (by cascade) their highlights; decks stay",
  },
  plain("player_event", "window_end", YEAR),
  plain("clan_event", "window_end", YEAR),
  plain(
    "clan_membership",
    "left_observed_at",
    YEAR,
    "left_observed_at is not null",
  ),
  plain("clan_snapshot_daily", "day", YEAR),
  plain("player_snapshot_daily", "snapshot_date", YEAR),
  plain("player_progress_daily", "day", YEAR),
  {
    ...plain("player_daily_battle_rollup", "day", YEAR),
    note: "a day's sums go with the battles they sum",
  },
  {
    table: "war_week",
    column: "coalesce(closed_at, finished_observed_at, started_observed_at)",
    columns: ["closed_at", "finished_observed_at", "started_observed_at"],
    window: YEAR,
    extra: "",
    kind: "war_week",
    note: "takes its attendance days, participation, period log and opponent rows; a week with no time at all stays",
  },
  plain("war_period_anchor", "first_observed_at", YEAR),
  plain("game_event_day", "day", YEAR),
  {
    ...plain("game_event", "last_seen_at", YEAR),
    kind: "game_event",
    note: "only once none of its days is left",
  },
  plain("player_pol_season", "observed_at", YEAR),
  {
    ...plain(ATTESTED_FACT_TABLE, "occurred_at", YEAR),
    kind: "attested",
    note: "its SQL lives with the facts' own module (attested-facts.mjs)",
  },
  plain("api_payload", "last_fetched_at", YEAR),

  // Accounts' own history, one year.
  plain("account_event", "created_at", YEAR),
  {
    ...plain("email_issue", "composed_at", YEAR),
    note: "its sends go with it (on delete cascade)",
  },
  plain("feedback", "created_at", YEAR, "status in ('done', 'declined')"),
  plain("timeline_cheer", "created_at", YEAR),
  plain("claim_challenge", "created_at", YEAR, "outcome <> 'open'"),
  plain(
    "collector_version_event",
    "observed_at",
    YEAR,
    "completed_at is not null",
  ),
  plain("oauth_code", "expires_at", YEAR),
  {
    ...plain("oauth_family", "absolute_expires_at", YEAR),
    kind: "oauth_family",
    note: "only once no token and no call log row points at it",
  },
  plain("capture_efficiency_daily", "day", YEAR),
]);

/** Time-keyed rows another sweep deletes on a shorter clock. */
export const OWN_TRIMS = Object.freeze({
  rate_limit: "7 days, sweepOperational (services/jobs)",
  credential_refusal: "30 days, sweepOperational",
  magic_login: "30 days past expiry, sweepOperational",
  discord_login: "1 day past expiry, sweepOperational",
  session: "30 days past expiry or revoke, sweepOperational",
  oauth_token: "90 days past expiry, sweepOperational",
  job: "7 days done, 30 days dead, sweepOperational",
  collector_fetch_error: "7 days, sweepOperational",
  discord_post: "90 days, purgeQuality (packages/syndication/quality)",
  discord_run: "90 days, purgeQuality",
  budget_charge: "8 days, the ledger's plan (packages/ledger)",
  live_fetch_result: "1 hour, the ingest pipeline",
  timeline_discord_told: "31 days, the timeline sync (packages/syndication)",
  clan_activity_discord_told: "31 days, the clan activity sync",
});

/** Rows that go with a trimmed parent, never by their own age. */
export const CHILDREN = Object.freeze({
  feedback_ref: "goes with its feedback item (on delete cascade)",
  email_send: "goes with its issue (on delete cascade)",
  battle_participant: "goes with its battle",
  battle_participant_round: "goes with its battle",
  battle_highlight: "goes with its battle (on delete cascade)",
  war_attendance_day: "goes with its war week",
  war_participation: "goes with its war week",
  war_period_log: "goes with its war week",
  war_week_clan: "goes with its war week",
});

/** Not history over time, so not trimmed by age. */
export const KEPT = Object.freeze({
  account: "the account itself; removal is its own path",
  account_clan: "a current follow",
  account_clan_declined: "a standing choice",
  account_discord: "a current link",
  account_email_pref: "a current mail setting",
  agent_identity: "a current agent",
  claim: "a current claim",
  recording: "what is being recorded now; the unfollowed trim reads it",
  service_token: "a credential, revoked rather than aged out",
  oauth_client: "a registered client",
  family_oauth_client: "a first-party client",
  integration: "a connected app",
  player_nickname: "a current nickname",
  timeline_feed_link: "a current feed link",
  timeline_discord: "a current cross-post setting",
  clan_activity_discord: "a current channel setting",
  timeline_reader: "a reader's cursor",
  bell_seen: "a reader's cursor",
  bell_week: "one cached week per account, rebuilt in place",
  home_feed: "one cached feed per account, rebuilt in place",
  home_clan_card: "one cached card per account, rebuilt in place",
  player: "a game identity; its history is what is trimmed",
  clan: "a game identity",
  card: "the card catalog",
  arena: "the arena catalog",
  deck: "canonical deck identity; surviving battles point at it",
  card_role: "vocabulary",
  card_role_version: "vocabulary",
  deck_alias: "vocabulary",
  season: "the calendar",
  mode_season: "the calendar",
  war_period: "the calendar",
  player_badge: "a player's current badges",
  player_card: "a player's current collection",
  player_profile_membership: "the latest profile read of a clan",
  battlelog_high_water: "a poll cursor, one row per observer",
  poll_state: "a poll cursor, one row per subject",
  payload_shape_seen: "the census of payload shapes",
  gateway: "a collector",
  collector_release: "the named release",
  collector_release_history: "which release was named when",
  collector_release_note: "release notes",
  budget_state: "the rate budget's one row",
  public_stats_cache: "the status page's cache",
  schema_migrations: "the migration ledger",
  clan_state:
    "Clan's own store, keyed by item rather than by time; an item-kind trim is not built",
  clan_state_import: "the record of Clan's one import",
});

const SQL_NAME = /^[a-z_]+$/;

function wherePast(entry) {
  const extra = entry.extra ? ` and ${entry.extra}` : "";
  return `${entry.column} < now() - $1::interval${extra}`;
}

/** The count of rows the trim would take today, by its own predicate. */
function countSql(entry) {
  if (entry.kind === "attested") return ATTESTED_FACT_RETENTION.count;
  if (entry.kind === "game_event")
    return `select count(*)::bigint as n from game_event g
             where g.last_seen_at < now() - $1::interval
               and not exists (select 1 from game_event_day d
                                where d.event_tag = g.event_tag
                                  and d.day >= (now() - $1::interval)::date)`;
  if (entry.kind === "oauth_family")
    return `select count(*)::bigint as n from oauth_family f
             where f.absolute_expires_at < now() - $1::interval
               and not exists (select 1 from oauth_token t where t.family_id = f.family_id)
               and not exists (select 1 from mcp_call_audit a
                                where a.oauth_family_id = f.family_id
                                  and a.created_at >= now() - '${DAYS_28}'::interval)`;
  return `select count(*)::bigint as n from ${entry.table} where ${wherePast(entry)}`;
}

/** One batch's delete; resolves to the rows it took. */
async function deleteBatch(db, entry, limits) {
  const window = entry.window;
  if (entry.kind === "battle") {
    const { rows } = await db.query(
      `select battle_id from battle
        where battle_time < now() - $1::interval
        order by battle_time limit $2`,
      [window, limits.battleBatch],
    );
    if (rows.length === 0) return { rows: 0 };
    const ids = rows.map((r) => r.battle_id);
    const events = await db.query(
      `delete from player_event where battle_id = any($1::text[])`,
      [ids],
    );
    const rounds = await db.query(
      `delete from battle_participant_round where battle_id = any($1::text[])`,
      [ids],
    );
    // battle_highlight goes by cascade from its participant.
    const parts = await db.query(
      `delete from battle_participant where battle_id = any($1::text[])`,
      [ids],
    );
    const battles = await db.query(
      `delete from battle where battle_id = any($1::text[])`,
      [ids],
    );
    return {
      rows: battles.rowCount,
      children: {
        player_event: events.rowCount,
        battle_participant_round: rounds.rowCount,
        battle_participant: parts.rowCount,
      },
      full: rows.length === limits.battleBatch,
    };
  }
  if (entry.kind === "war_week") {
    const { rows } = await db.query(
      `select clan_tag, season_id, section_index from war_week
        where ${wherePast(entry)}
        limit $2`,
      [window, limits.batchRows],
    );
    if (rows.length === 0) return { rows: 0 };
    const keys = [
      rows.map((r) => r.clan_tag),
      rows.map((r) => r.season_id),
      rows.map((r) => r.section_index),
    ];
    const children = {};
    for (const child of [
      "war_attendance_day",
      "war_participation",
      "war_period_log",
      "war_week_clan",
    ]) {
      children[child] = (
        await db.query(
          `delete from ${child} c
            using unnest($1::text[], $2::int[], $3::int[]) as k(clan_tag, season_id, section_index)
            where c.clan_tag = k.clan_tag and c.season_id = k.season_id
              and c.section_index = k.section_index`,
          keys,
        )
      ).rowCount;
    }
    const weeks = await db.query(
      `delete from war_week w
        using unnest($1::text[], $2::int[], $3::int[]) as k(clan_tag, season_id, section_index)
        where w.clan_tag = k.clan_tag and w.season_id = k.season_id
          and w.section_index = k.section_index`,
      keys,
    );
    return {
      rows: weeks.rowCount,
      children,
      full: rows.length === limits.batchRows,
    };
  }
  if (entry.kind === "game_event") {
    const r = await db.query(
      `delete from game_event g
        where g.event_tag = any(array(
          select g2.event_tag from game_event g2
           where g2.last_seen_at < now() - $1::interval
             and not exists (select 1 from game_event_day d where d.event_tag = g2.event_tag)
           limit $2))`,
      [window, limits.batchRows],
    );
    return { rows: r.rowCount, full: r.rowCount === limits.batchRows };
  }
  if (entry.kind === "oauth_family") {
    const r = await db.query(
      `delete from oauth_family f
        where f.family_id = any(array(
          select f2.family_id from oauth_family f2
           where f2.absolute_expires_at < now() - $1::interval
             and not exists (select 1 from oauth_token t where t.family_id = f2.family_id)
             and not exists (select 1 from mcp_call_audit a where a.oauth_family_id = f2.family_id)
           limit $2))`,
      [window, limits.batchRows],
    );
    return { rows: r.rowCount, full: r.rowCount === limits.batchRows };
  }
  if (entry.kind === "attested") {
    const r = await db.query(ATTESTED_FACT_RETENTION.deleteBatch, [
      window,
      limits.batchRows,
    ]);
    return { rows: r.rowCount, full: r.rowCount === limits.batchRows };
  }
  if (entry.kind === "api_receipt") {
    // capture_audit runs first and holds the only foreign key left on a
    // receipt (0258 dropped the event and snapshot ones); a receipt still
    // audited waits for its audit row.
    const r = await db.query(
      `delete from api_receipt
        where ctid = any(array(
          select r2.ctid from api_receipt r2
           where r2.fetched_at < now() - $1::interval
             and not exists (select 1 from capture_audit ca where ca.receipt_id = r2.receipt_id)
           limit $2))`,
      [window, limits.batchRows],
    );
    return { rows: r.rowCount, full: r.rowCount === limits.batchRows };
  }
  const r = await db.query(
    `delete from ${entry.table}
      where ctid = any(array(
        select ctid from ${entry.table} where ${wherePast(entry)} limit $2))`,
    [window, limits.batchRows],
  );
  return { rows: r.rowCount, full: r.rowCount === limits.batchRows };
}

/**
 * The daily trim. `db` is a connected pg client on the database to trim;
 * nothing here picks a database. Returns per-table counts:
 * `{ tables: { [table]: { deleted, batches, done, children?, error? } },
 *    held: [table], statements, stopped? }`.
 *
 * `runHeld` runs the held entries too; only the tests set it.
 */
export async function retentionTrim(
  db,
  {
    limits: given = {},
    runHeld = false,
    remainingMs = null,
    clock = () => Date.now(),
  } = {},
) {
  const limits = { ...TRIM_LIMITS, ...given };
  const started = clock();
  const outOfTime = () =>
    clock() - started > limits.budgetMs ||
    (remainingMs !== null && remainingMs() < 60_000);
  const out = { tables: {}, held: [], statements: 0 };
  for (const entry of TRIMMED) {
    if (entry.held && !runHeld) {
      out.held.push(entry.table);
      continue;
    }
    const t = { deleted: 0, batches: 0, done: false };
    out.tables[entry.table] = t;
    while (!t.done) {
      if (t.batches >= limits.tableStatements) break;
      if (out.statements >= limits.runStatements || outOfTime()) {
        out.stopped =
          out.statements >= limits.runStatements ? "statements" : "time";
        break;
      }
      t.batches += 1;
      out.statements += 1;
      try {
        await db.query("begin");
        await db.query("set local statement_timeout = '20s'");
        await db.query("set local lock_timeout = '5s'");
        const r = await deleteBatch(db, entry, limits);
        await db.query("commit");
        t.deleted += r.rows;
        if (r.children) {
          t.children ??= {};
          for (const [k, v] of Object.entries(r.children))
            t.children[k] = (t.children[k] ?? 0) + v;
        }
        if (!r.full) t.done = true;
      } catch (err) {
        await db.query("rollback").catch(() => {});
        t.error = String(err?.message ?? err).slice(0, 200);
        break;
      }
    }
    if (out.stopped) break;
  }
  return out;
}

/**
 * What the trim would take today, without taking it: per declared table,
 * its window and column, the rows past the window, and the table's size.
 * Held entries are counted and marked. Reads only.
 */
export async function retentionDryRun(db) {
  const tables = [];
  await db.query("begin read only");
  try {
    await db.query("set local statement_timeout = '60s'");
    for (const entry of TRIMMED) {
      if (!SQL_NAME.test(entry.table)) throw new Error("bad table name");
      const row = {
        table: entry.table,
        column: entry.column,
        window: entry.window,
        held: Boolean(entry.held),
      };
      try {
        const {
          rows: [c],
        } = await db.query(countSql(entry), [entry.window]);
        row.rows_due = Number(c.n);
        if (entry.kind === "battle") {
          const {
            rows: [k],
          } = await db.query(
            `select
               (select count(*) from battle_participant p join battle b using (battle_id)
                 where b.battle_time < now() - $1::interval)::bigint as participants,
               (select count(*) from battle_participant_round p join battle b using (battle_id)
                 where b.battle_time < now() - $1::interval)::bigint as rounds,
               (select count(*) from battle_highlight h join battle b using (battle_id)
                 where b.battle_time < now() - $1::interval)::bigint as highlights`,
            [entry.window],
          );
          row.children_due = {
            battle_participant: Number(k.participants),
            battle_participant_round: Number(k.rounds),
            battle_highlight: Number(k.highlights),
          };
        }
        const {
          rows: [s],
        } = await db.query(
          `select pg_total_relation_size($1::regclass)::bigint as bytes`,
          [entry.table],
        );
        row.total_bytes = Number(s.bytes);
      } catch (err) {
        row.error = String(err?.message ?? err).slice(0, 200);
        await db.query("rollback");
        await db.query("begin read only");
        await db.query("set local statement_timeout = '60s'");
      }
      tables.push(row);
    }
  } finally {
    await db.query("rollback").catch(() => {});
  }
  return {
    windows: { operational: DAYS_28, record: YEAR },
    tables,
  };
}
