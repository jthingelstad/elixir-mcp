import pg from "pg";
import {
  KEEP_SQL,
  PLAYER_ENDPOINTS,
  CLAN_ENDPOINTS,
  RETIRED_ENDPOINTS,
  PLAYER_TABLES,
} from "./ops-tracked-census.mjs";

/** The tracked-only correction (Jamie, 2026-10-06, approved on the
 *  `{tracked_census}` numbers): remove what nobody tracks today. The keep
 *  rule is the census's (KEEP_SQL), recomputed at the start of every
 *  batch, so a player tracked mid-run is kept from the next batch on.
 *  One keyset-paged batch per call, in its own transaction; without
 *  `apply` a call only selects the batch. Identity rows (player, clan,
 *  deck) go last, and only when nothing left in the record names them.
 *  Run the phases in PHASES order, each until `done`. */

export const PHASES = [
  "relabel",
  "receipts",
  "battles",
  "player_rows",
  "clan_rows",
  "players",
  "clans",
  "decks",
  "ledger",
];

const MAX_LIMIT = {
  relabel: 1,
  receipts: 20000,
  battles: 5000,
  player_rows: 10000,
  clan_rows: 2000,
  players: 20000,
  clans: 20000,
  decks: 20000,
  ledger: 20000,
};

const FIELDS = new Set(["phase", "after", "limit", "apply", "keep_at_least"]);

// Every table that can still name a player once the rows above are gone.
const PLAYER_REFS = [
  ["claim", "player_tag"],
  ["clan_membership", "player_tag"],
  ["battle_participant", "player_tag"],
  ["clan_event", "player_tag"],
  ["war_participation", "player_tag"],
  ["war_attendance_day", "player_tag"],
  ["agent_identity", "player_tag"],
  ["battlelog_high_water", "observer_tag"],
  ["player_profile_membership", "player_tag"],
  ["player_nickname", "player_tag"],
  ["email_milestone", "subject_tag"],
  ["integration_profile_refresh", "player_tag"],
  ["claim_challenge", "player_tag"],
  ...PLAYER_TABLES.map((t) => [t, "player_tag"]),
];

// Every table that can still name a clan: its own rows, the rivals in a
// tracked clan's races, the clans on kept battles and kept players.
const CLAN_REFS = [
  ["clan_membership", "clan_tag"],
  ["clan_event", "clan_tag"],
  ["player_snapshot_daily", "clan_tag"],
  ["clan_snapshot_daily", "clan_tag"],
  ["war_week", "clan_tag"],
  ["war_week_clan", "clan_tag"],
  ["war_week_clan", "participant_clan_tag"],
  ["war_period_log", "clan_tag"],
  ["war_period_log", "participant_clan_tag"],
  ["war_participation", "clan_tag"],
  ["war_attendance_day", "clan_tag"],
  ["war_period_anchor", "clan_tag"],
  ["agent_policy_context_grant", "clan_tag"],
  ["account_clan", "clan_tag"],
  ["battle_participant", "clan_tag"],
  ["player", "last_known_clan_tag"],
];

const unreferenced = (alias, column, refs) =>
  refs
    .map(
      ([table, col]) =>
        `and not exists (select 1 from ${table} r where r.${col} = ${alias}.${column})`,
    )
    .join("\n          ");

async function keepSets(db) {
  await db.query(
    `create temp table tp_keep on commit drop as
       with ${KEEP_SQL} select player_tag from keep_players`,
  );
  await db.query(
    `create temp table tp_clans on commit drop as
       with ${KEEP_SQL} select clan_tag from tracked_clans`,
  );
  await db.query("alter table tp_keep add primary key (player_tag)");
  await db.query("alter table tp_clans add primary key (clan_tag)");
  await db.query("analyze tp_keep");
  await db.query("analyze tp_clans");
  const {
    rows: [n],
  } = await db.query(
    `select (select count(*) from tp_keep)::int as players,
            (select count(*) from tp_clans)::int as clans`,
  );
  return n;
}

async function deleteEach(db, steps, ids) {
  const deleted = {};
  for (const [name, sql] of steps) {
    const { rowCount } = await db.query(sql, [ids]);
    deleted[name] = (deleted[name] ?? 0) + rowCount;
  }
  return deleted;
}

const RUN = {
  // The active player recordings a claim explains, labelled as claims
  // (the census's `recordings` part: all thirteen are claimed).
  async relabel(db, { apply }) {
    const { rows } = await db.query(
      `select r.recording_id from recording r
        where r.subject_type = 'player' and r.status = 'active'
          and r.origin <> 'claim'
          and exists (select 1 from claim c where c.player_tag = r.subject_tag)`,
    );
    const ids = rows.map((r) => r.recording_id);
    let relabelled = 0;
    if (apply && ids.length > 0)
      ({ rowCount: relabelled } = await db.query(
        "update recording set origin = 'claim' where recording_id = any($1::uuid[])",
        [ids],
      ));
    return { selected: ids.length, deleted: { relabelled }, next: null };
  },

  // Never replay what is about to go: receipts for subjects nobody
  // tracks and for the retired global endpoints.
  async receipts(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select receipt_id from api_receipt r
        where r.receipt_id > $1 and r.replay_retired_at is null
          and ((r.endpoint = any($2)
                and not exists (select 1 from tp_keep k where k.player_tag = r.entity_key))
            or (r.endpoint = any($3)
                and not exists (select 1 from tp_clans c where c.clan_tag = r.entity_key))
            or r.endpoint = any($4))
        order by r.receipt_id limit $5`,
      [after ?? 0, PLAYER_ENDPOINTS, CLAN_ENDPOINTS, RETIRED_ENDPOINTS, limit],
    );
    const ids = rows.map((r) => r.receipt_id);
    const deleted = { retired: 0 };
    if (apply && ids.length > 0)
      ({ rowCount: deleted.retired } = await db.query(
        `update api_receipt set replay_retired_at = now(), replay_payload_hash = null
          where receipt_id = any($1::bigint[])`,
        [ids],
      ));
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  async battles(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select b.battle_id from battle b
        where b.battle_id > $1
          and not exists (select 1 from battle_participant bp
                            join tp_keep k on k.player_tag = bp.player_tag
                           where bp.battle_id = b.battle_id)
        order by b.battle_id limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.battle_id);
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            [
              "player_event",
              "battle_participant_card",
              "battle_participant_round",
              "battle_participant",
              "battle",
            ].map((t) => [
              t,
              `delete from ${t} where battle_id = any($1::text[])`,
            ]),
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  // A player nobody keeps loses every row of its own; the identity row
  // waits for `players`.
  async player_rows(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select p.player_tag from player p
        where p.player_tag > $1
          and not exists (select 1 from tp_keep k where k.player_tag = p.player_tag)
        order by p.player_tag limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.player_tag);
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            [
              ...PLAYER_TABLES.map((t) => [
                t,
                `delete from ${t} where player_tag = any($1::text[])`,
              ]),
              [
                "battlelog_high_water",
                "delete from battlelog_high_water where observer_tag = any($1::text[])",
              ],
              [
                "player_profile_membership",
                "delete from player_profile_membership where player_tag = any($1::text[])",
              ],
            ],
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  // A clan nobody tracks loses its own series and war rows; memberships
  // and events stay where they name a kept player.
  async clan_rows(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select c.clan_tag from clan c
        where c.clan_tag > $1
          and not exists (select 1 from tp_clans t where t.clan_tag = c.clan_tag)
        order by c.clan_tag limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.clan_tag);
    const own = (t) => [t, `delete from ${t} where clan_tag = any($1::text[])`];
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            [
              own("war_participation"),
              own("war_attendance_day"),
              own("war_period_log"),
              own("war_week_clan"),
              own("war_week"),
              own("war_period_anchor"),
              own("clan_snapshot_daily"),
              [
                "clan_membership",
                `delete from clan_membership x where x.clan_tag = any($1::text[])
                   and not exists (select 1 from tp_keep k where k.player_tag = x.player_tag)`,
              ],
              [
                "clan_event",
                `delete from clan_event x where x.clan_tag = any($1::text[])
                   and (x.player_tag is null
                        or not exists (select 1 from tp_keep k where k.player_tag = x.player_tag))`,
              ],
            ],
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  async players(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select p.player_tag from player p
        where p.player_tag > $1
          and not exists (select 1 from tp_keep k where k.player_tag = p.player_tag)
          and not exists (select 1 from recording r
                           where r.subject_type = 'player' and r.status = 'active'
                             and r.subject_tag = p.player_tag)
          ${unreferenced("p", "player_tag", PLAYER_REFS)}
        order by p.player_tag limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.player_tag);
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            [
              [
                "player",
                "delete from player where player_tag = any($1::text[])",
              ],
            ],
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  async clans(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select c.clan_tag from clan c
        where c.clan_tag > $1
          and not exists (select 1 from tp_clans t where t.clan_tag = c.clan_tag)
          and not exists (select 1 from recording r
                           where r.subject_type = 'clan' and r.status = 'active'
                             and r.subject_tag = c.clan_tag)
          ${unreferenced("c", "clan_tag", CLAN_REFS)}
        order by c.clan_tag limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.clan_tag);
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            [["clan", "delete from clan where clan_tag = any($1::text[])"]],
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  async decks(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select d.deck_hash from deck d
        where d.deck_hash > $1
          and not exists (select 1 from battle_participant r where r.deck_hash = d.deck_hash)
          and not exists (select 1 from battle_participant_round r where r.deck_hash = d.deck_hash)
        order by d.deck_hash limit $2`,
      [after ?? "", limit],
    );
    const ids = rows.map((r) => r.deck_hash);
    const deleted =
      apply && ids.length > 0
        ? await deleteEach(
            db,
            ["deck_card", "deck"].map((t) => [
              t,
              `delete from ${t} where deck_hash = any($1::text[])`,
            ]),
            ids,
          )
        : {};
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },

  // Poll rows the planner would not seed today, and the payload cache
  // rows of the receipts retired above.
  async ledger(db, { after, limit, apply }) {
    const { rows } = await db.query(
      `select payload_id from api_payload r
        where r.payload_id > $1
          and ((r.endpoint = any($2)
                and not exists (select 1 from tp_keep k where k.player_tag = r.entity_key))
            or (r.endpoint = any($3)
                and not exists (select 1 from tp_clans c where c.clan_tag = r.entity_key))
            or r.endpoint = any($4))
        order by r.payload_id limit $5`,
      [after ?? 0, PLAYER_ENDPOINTS, CLAN_ENDPOINTS, RETIRED_ENDPOINTS, limit],
    );
    const ids = rows.map((r) => r.payload_id);
    const deleted = { api_payload: 0, poll_state: 0 };
    if (!apply)
      return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
    if (ids.length > 0)
      ({ rowCount: deleted.api_payload } = await db.query(
        "delete from api_payload where payload_id = any($1::bigint[])",
        [ids],
      ));
    if (after == null)
      ({ rowCount: deleted.poll_state } = await db.query(
        `delete from poll_state ps
          where ps.subject_tag <> 'GLOBAL'
            and not (
              (ps.endpoint = any($1) and ps.subject_tag in (
                 select subject_tag from recording
                  where subject_type = 'player' and status = 'active'
                 union
                 select cm.player_tag from recording r
                   join clan_membership cm on cm.clan_tag = r.subject_tag
                    and cm.left_observed_at is null
                  where r.subject_type = 'clan' and r.status = 'active'
                    and r.scope = 'comprehensive'))
              or (ps.endpoint = any($2) and ps.subject_tag in (
                 select subject_tag from recording
                  where subject_type = 'clan' and status = 'active'))
              or (ps.endpoint = 'clan' and ps.subject_tag in (
                 select p.last_known_clan_tag from recording r
                   join player p on p.player_tag = r.subject_tag
                  where r.subject_type = 'player' and r.status = 'active'
                    -- A clanless recorded player must not put a null in
                    -- the list: NOT (x IN (..., null)) is never true.
                    and p.last_known_clan_tag is not null)))`,
        [PLAYER_ENDPOINTS, CLAN_ENDPOINTS],
      ));
    return { selected: ids.length, deleted, next: ids.at(-1) ?? null };
  },
};

function refuse(reason, extra = {}) {
  return { error: "invalid_tracked_purge", reason, ...extra };
}

export async function trackedPurge(databaseUrl, spec, client = null) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    return refuse("object_required");
  if (Object.keys(spec).some((key) => !FIELDS.has(key)))
    return refuse("unknown_fields");
  if (!PHASES.includes(spec.phase))
    return refuse("unknown_phase", { phases: PHASES });
  const apply = spec.apply === true;
  if (spec.apply !== undefined && typeof spec.apply !== "boolean")
    return refuse("apply_boolean");
  const floor = spec.keep_at_least;
  if (
    apply &&
    !(
      floor &&
      Number.isInteger(floor.players) &&
      floor.players > 0 &&
      Number.isInteger(floor.clans) &&
      floor.clans > 0
    )
  )
    return refuse("keep_at_least_required");
  const max = MAX_LIMIT[spec.phase];
  const limit = spec.limit ?? max;
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    return refuse("limit_out_of_range", { max });
  const db =
    client ??
    new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
  let transaction = false;
  try {
    await db.connect();
    await db.query("begin");
    transaction = true;
    await db.query("set local statement_timeout = '80s'");
    await db.query("set local lock_timeout = '2s'");
    const started = Date.now();
    const kept = await keepSets(db);
    if (apply && (kept.players < floor.players || kept.clans < floor.clans)) {
      await db.query("rollback");
      transaction = false;
      return refuse("keep_set_below_floor", { kept, floor });
    }
    const result = await RUN[spec.phase](db, {
      after: spec.after ?? null,
      limit,
      apply,
    });
    await db.query(apply ? "commit" : "rollback");
    transaction = false;
    return {
      phase: spec.phase,
      apply,
      kept,
      ...result,
      done: result.selected < limit,
      elapsed_ms: Date.now() - started,
    };
  } catch (err) {
    if (transaction) await db.query("rollback").catch(() => {});
    return {
      error: "tracked_purge_failed",
      phase: spec.phase,
      message: err.message,
    };
  } finally {
    await db.end().catch(() => {});
  }
}
