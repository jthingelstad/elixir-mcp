/**
 * Cards as arrays (0255): the history fill and the census that proves it.
 *
 *   {card_arrays: true}
 *   {card_arrays: {phase?, after?, batch?, budget_ms?}}
 *     Write. Fills the 0255 arrays on rows whose arrays are still null,
 *     from the card rows, with the same SQL ingest uses
 *     (@elixir-mcp/ingest/card-arrays). Three phases in order:
 *     participants (battle_participant), rounds (battle_participant_round),
 *     decks (deck). Keyset on each table's primary key, one statement per
 *     batch, autocommit, so a killed invocation loses at most one batch
 *     and nothing is left half-written. Bounded per invocation by
 *     budget_ms (default 45 s, at most 60 s); returns `next`, the payload
 *     for the following call, until `done`. Idempotent: a filled row is
 *     never selected again, and an update that changes nothing is not
 *     written.
 *
 *   {card_arrays_census: true}
 *   {card_arrays_census: {phase?, after?, carry?, batch?, budget_ms?}}
 *     Read-only. Compares every array element with the card row it
 *     stands for, by (battle, player, round, slot) and every field, and
 *     every deck's arrays with its deck_card rows. Independent of the fill
 *     SQL: it unnests the arrays and full-joins the rows. Paged the same
 *     way; `carry` holds the running counts, and `pass` is set when the
 *     last page is read.
 */

import pg from "pg";
import {
  fillDeckArrays,
  fillParticipantArrays,
  fillRoundArrays,
} from "@elixir-mcp/ingest/card-arrays";

const PHASES = ["participants", "rounds", "decks"];

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : dflt;
};

function readSpec(spec, { batchDefault, batchMax }) {
  const s = spec && typeof spec === "object" ? spec : {};
  const phase = s.phase ?? PHASES[0];
  if (!PHASES.includes(phase))
    throw new Error(`phase: one of ${PHASES.join(", ")}`);
  const after = s.after ?? null;
  if (after !== null && (typeof after !== "object" || Array.isArray(after)))
    throw new Error("after: the cursor a previous call returned");
  return {
    phase,
    after,
    batch: clamp(s.batch, 1, batchMax, batchDefault),
    budget: clamp(s.budget_ms, 1000, 60000, 45000),
    // A second bound beside the clock, for a deliberately short call.
    maxBatches: clamp(s.max_batches, 1, 1e6, Infinity),
  };
}

/** The keyset per phase: the table's primary key, as a row comparison. */
const KEYS = {
  participants: {
    table: "battle_participant",
    cols: ["battle_id", "player_tag"],
    filled: "cards",
  },
  rounds: {
    table: "battle_participant_round",
    cols: ["battle_id", "player_tag", "round"],
    filled: "cards",
  },
  decks: { table: "deck", cols: ["deck_hash"], filled: "card_ids" },
};

/** `(a, b) > ($1, $2)` for the phase's key, or `true` from the start. */
function cursorSql(phase, after, offset = 1) {
  const { cols } = KEYS[phase];
  if (!after) return { sql: "true", params: [] };
  for (const c of cols)
    if (after[c] === undefined || after[c] === null)
      throw new Error(`after: missing ${c} for phase ${phase}`);
  const params = cols.map((c) => after[c]);
  const ph = cols.map((_c, i) => `$${offset + i}`);
  return { sql: `(${cols.join(", ")}) > (${ph.join(", ")})`, params };
}

async function withRetry(fn, tally) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Ingest writes the same rows: a deadlock victim replays its batch
      // (the guards make the replay exact).
      if (err?.code === "40P01" && attempt < 3) {
        tally.deadlock_retries += 1;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

const FILLERS = {
  participants: fillParticipantArrays,
  rounds: fillRoundArrays,
  decks: (db, keys) =>
    fillDeckArrays(
      db,
      keys.map((k) => k.deck_hash),
    ),
};

export async function cardArrays(databaseUrl, spec) {
  let { phase, after, batch, budget, maxBatches } = readSpec(spec, {
    batchDefault: 2000,
    batchMax: 20000,
  });
  const started = Date.now();
  const tally = {
    batches: 0,
    scanned: 0,
    filled: 0,
    deadlock_retries: 0,
    phases: {},
  };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    let done = false;
    let rounds = 0;
    while (!done && rounds < maxBatches && Date.now() - started < budget) {
      rounds += 1;
      const { table, cols, filled } = KEYS[phase];
      const cur = cursorSql(phase, after);
      const { rows: keys } = await db.query(
        `select ${cols.join(", ")} from ${table}
          where ${filled} is null and ${cur.sql}
          order by ${cols.join(", ")}
          limit $${cur.params.length + 1}`,
        [...cur.params, batch],
      );
      if (keys.length > 0) {
        const n = await withRetry(() => FILLERS[phase](db, keys), tally);
        tally.batches += 1;
        tally.scanned += keys.length;
        tally.filled += n;
        const p = (tally.phases[phase] ??= {
          batches: 0,
          scanned: 0,
          filled: 0,
        });
        p.batches += 1;
        p.scanned += keys.length;
        p.filled += n;
        after = Object.fromEntries(
          cols.map((c) => [c, keys[keys.length - 1][c]]),
        );
      }
      if (keys.length < batch) {
        const i = PHASES.indexOf(phase);
        if (i === PHASES.length - 1) done = true;
        else {
          phase = PHASES[i + 1];
          after = null;
        }
      }
    }
    // Rows still null past the cursor in this phase and in the phases to
    // come: an upper bound, since a duel's participant row and a row with
    // no card rows stay null for good.
    let remaining = 0;
    if (!done) {
      const cur = cursorSql(phase, after);
      const { table, filled } = KEYS[phase];
      remaining += (
        await db.query(
          `select count(*)::int as n from ${table} where ${filled} is null and ${cur.sql}`,
          cur.params,
        )
      ).rows[0].n;
      for (const later of PHASES.slice(PHASES.indexOf(phase) + 1))
        remaining += (
          await db.query(
            `select count(*)::int as n from ${KEYS[later].table} where ${KEYS[later].filled} is null`,
          )
        ).rows[0].n;
    }
    return {
      ...tally,
      done,
      phase: done ? null : phase,
      after: done ? null : after,
      remaining,
      next: done
        ? null
        : { card_arrays: { phase, after, batch, budget_ms: budget } },
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}

/* ------------------------------------------------------------------ */
/* Census                                                              */
/* ------------------------------------------------------------------ */

/** One page of participants: their round-0 arrays and tower columns
 *  against their round-0 card rows, element by element; plus the card
 *  rows of later rounds that no round row holds, and round-0 `used`
 *  values the arrays have no place for. */
const PARTICIPANT_CENSUS = (cursor, limitParam) => `
with k as (
  select battle_id, player_tag, cards, card_forms, card_levels, card_stars,
         tower_troop_id, tower_form, tower_level, tower_star
  from battle_participant
  where ${cursor}
  order by battle_id, player_tag
  limit $${limitParam}
),
el as (
  select k.battle_id, k.player_tag, u.slot::int as slot,
         u.card_id, u.form, u.level, u.star
  from k
  cross join lateral unnest(k.cards, k.card_forms, k.card_levels, k.card_stars)
    with ordinality as u(card_id, form, level, star, slot)
  where u.card_id is not null
  union all
  select battle_id, player_tag, 0, tower_troop_id, tower_form, tower_level, tower_star
  from k where tower_troop_id is not null
),
rw as (
  select c.battle_id, c.player_tag, c.slot::int as slot, c.card_id, c.form,
         c.level, c.star_level as star, c.used
  from k join battle_participant_card c
    on c.battle_id = k.battle_id and c.player_tag = k.player_tag and c.round = 0
),
j as (
  select e.card_id as e_id, r.card_id as r_id,
         (e.card_id, e.form, e.level, e.star) is not distinct from
         (r.card_id, r.form, r.level, r.star) as same
  from el e
  full join rw r
    on r.battle_id = e.battle_id and r.player_tag = e.player_tag and r.slot = e.slot
)
select
  (select count(*) from k)::int as scanned,
  (select battle_id from k order by battle_id desc, player_tag desc limit 1) as last_battle_id,
  (select player_tag from k order by battle_id desc, player_tag desc limit 1) as last_player_tag,
  (select count(*) from j where e_id is not null and r_id is not null and same)::int as matched,
  (select count(*) from j where e_id is not null and r_id is not null and not same)::int as mismatched,
  (select count(*) from j where e_id is null)::int as rows_missing_from_arrays,
  (select count(*) from j where r_id is null)::int as elements_without_row,
  (select count(*) from rw)::int as rows,
  (select count(*) from el)::int as elements,
  (select count(*) from rw where used is not null)::int as round0_used_rows,
  (select count(*) from k
    where k.cards is null and k.tower_troop_id is null
      and exists (select 1 from rw where rw.battle_id = k.battle_id and rw.player_tag = k.player_tag))::int
    as null_where_rows_exist,
  (select count(*) from k
    where k.cards is not null and not exists
      (select 1 from rw where rw.battle_id = k.battle_id and rw.player_tag = k.player_tag))::int
    as arrays_without_rows,
  (select count(*) from k
    where cardinality(k.cards) is distinct from cardinality(k.card_forms)
       or cardinality(k.cards) is distinct from cardinality(k.card_levels)
       or cardinality(k.cards) is distinct from cardinality(k.card_stars)
       or exists (select 1 from unnest(k.cards, k.card_forms, k.card_levels, k.card_stars) as u(c, f, l, s)
                   where u.c is null and (u.f is not null or u.l is not null or u.s is not null))
       or (k.tower_troop_id is null and (k.tower_form is not null or k.tower_level is not null or k.tower_star is not null)))::int
    as malformed,
  (select count(*) from k join battle_participant_card c
     on c.battle_id = k.battle_id and c.player_tag = k.player_tag and c.round > 0
    where not exists (select 1 from battle_participant_round r
                       where r.battle_id = c.battle_id and r.player_tag = c.player_tag and r.round = c.round))::int
    as round_rows_without_round_row`;

const ROUND_CENSUS = (cursor, limitParam) => `
with k as (
  select battle_id, player_tag, round, cards, card_forms, card_levels, card_stars, cards_used
  from battle_participant_round
  where ${cursor}
  order by battle_id, player_tag, round
  limit $${limitParam}
),
el as (
  select k.battle_id, k.player_tag, k.round, u.slot::int as slot,
         u.card_id, u.form, u.level, u.star, u.used
  from k
  cross join lateral unnest(k.cards, k.card_forms, k.card_levels, k.card_stars, k.cards_used)
    with ordinality as u(card_id, form, level, star, used, slot)
  where u.card_id is not null
),
rw as (
  select c.battle_id, c.player_tag, c.round, c.slot::int as slot, c.card_id,
         c.form, c.level, c.star_level as star, c.used
  from k join battle_participant_card c
    on c.battle_id = k.battle_id and c.player_tag = k.player_tag and c.round = k.round
),
j as (
  select e.card_id as e_id, r.card_id as r_id,
         (e.card_id, e.form, e.level, e.star, e.used) is not distinct from
         (r.card_id, r.form, r.level, r.star, r.used) as same
  from el e
  full join rw r
    on r.battle_id = e.battle_id and r.player_tag = e.player_tag
   and r.round = e.round and r.slot = e.slot
)
select
  (select count(*) from k)::int as scanned,
  (select battle_id from k order by battle_id desc, player_tag desc, round desc limit 1) as last_battle_id,
  (select player_tag from k order by battle_id desc, player_tag desc, round desc limit 1) as last_player_tag,
  (select round from k order by battle_id desc, player_tag desc, round desc limit 1) as last_round,
  (select count(*) from j where e_id is not null and r_id is not null and same)::int as matched,
  (select count(*) from j where e_id is not null and r_id is not null and not same)::int as mismatched,
  (select count(*) from j where e_id is null)::int as rows_missing_from_arrays,
  (select count(*) from j where r_id is null)::int as elements_without_row,
  (select count(*) from rw)::int as rows,
  (select count(*) from el)::int as elements,
  (select count(*) from k
    where k.cards is null
      and exists (select 1 from rw where rw.battle_id = k.battle_id and rw.player_tag = k.player_tag and rw.round = k.round))::int
    as null_where_rows_exist,
  (select count(*) from k
    where k.cards is not null and not exists
      (select 1 from rw where rw.battle_id = k.battle_id and rw.player_tag = k.player_tag and rw.round = k.round))::int
    as arrays_without_rows,
  (select count(*) from k
    where cardinality(k.cards) is distinct from cardinality(k.card_forms)
       or cardinality(k.cards) is distinct from cardinality(k.card_levels)
       or cardinality(k.cards) is distinct from cardinality(k.card_stars)
       or cardinality(k.cards) is distinct from cardinality(k.cards_used)
       or exists (select 1 from unnest(k.cards, k.card_forms, k.card_levels, k.card_stars, k.cards_used) as u(c, f, l, s, x)
                   where u.c is null and (u.f is not null or u.l is not null or u.s is not null or u.x is not null)))::int
    as malformed`;

const DECK_CENSUS = (cursor, limitParam) => `
with k as (
  select deck_hash, card_ids, card_forms
  from deck
  where ${cursor}
  order by deck_hash
  limit $${limitParam}
),
agg as (
  select dc.deck_hash,
         array_agg(dc.card_id order by dc.card_id, dc.form) as card_ids,
         array_agg(dc.form order by dc.card_id, dc.form) as card_forms,
         count(*) as n
  from k join deck_card dc on dc.deck_hash = k.deck_hash
  group by dc.deck_hash
)
select
  (select count(*) from k)::int as scanned,
  (select max(deck_hash) from k) as last_deck_hash,
  (select count(*) from k join agg using (deck_hash)
    where k.card_ids is not null
      and (k.card_ids, k.card_forms) is not distinct from (agg.card_ids, agg.card_forms))::int as matched,
  (select count(*) from k join agg using (deck_hash)
    where k.card_ids is not null
      and (k.card_ids, k.card_forms) is distinct from (agg.card_ids, agg.card_forms))::int as mismatched,
  (select count(*) from k join agg using (deck_hash) where k.card_ids is null)::int as null_where_rows_exist,
  (select count(*) from k where k.card_ids is not null
     and not exists (select 1 from agg where agg.deck_hash = k.deck_hash))::int as arrays_without_rows,
  (select coalesce(sum(n), 0) from agg)::int as rows,
  (select coalesce(sum(cardinality(card_ids)), 0) from k)::int as elements,
  (select count(*) from k
    where cardinality(k.card_ids) is distinct from cardinality(k.card_forms)
       or array_position(k.card_ids, null) is not null
       or array_position(k.card_forms, null) is not null)::int as malformed`;

const CENSUS = {
  participants: {
    sql: PARTICIPANT_CENSUS,
    cursorOf: (r) => ({
      battle_id: r.last_battle_id,
      player_tag: r.last_player_tag,
    }),
  },
  rounds: {
    sql: ROUND_CENSUS,
    cursorOf: (r) => ({
      battle_id: r.last_battle_id,
      player_tag: r.last_player_tag,
      round: r.last_round,
    }),
  },
  decks: {
    sql: DECK_CENSUS,
    cursorOf: (r) => ({ deck_hash: r.last_deck_hash }),
  },
};

/** The counts that must be zero for a pass, per phase. */
const MUST_BE_ZERO = {
  participants: [
    "mismatched",
    "rows_missing_from_arrays",
    "elements_without_row",
    "null_where_rows_exist",
    "arrays_without_rows",
    "malformed",
    "round0_used_rows",
    "round_rows_without_round_row",
  ],
  rounds: [
    "mismatched",
    "rows_missing_from_arrays",
    "elements_without_row",
    "null_where_rows_exist",
    "arrays_without_rows",
    "malformed",
  ],
  decks: [
    "mismatched",
    "null_where_rows_exist",
    "arrays_without_rows",
    "malformed",
  ],
};

const SKIP = new Set([
  "last_battle_id",
  "last_player_tag",
  "last_round",
  "last_deck_hash",
]);

function emptyCarry() {
  return Object.fromEntries(PHASES.map((p) => [p, {}]));
}

export async function cardArraysCensus(databaseUrl, spec) {
  let { phase, after, batch, budget, maxBatches } = readSpec(spec, {
    batchDefault: 5000,
    batchMax: 50000,
  });
  const given = spec && typeof spec === "object" ? spec.carry : null;
  const carry = emptyCarry();
  if (given && typeof given === "object")
    for (const p of PHASES)
      for (const [k, v] of Object.entries(given[p] ?? {}))
        if (Number.isFinite(Number(v))) carry[p][k] = Number(v);
  const started = Date.now();
  let pages = 0;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // Nothing this op runs can write.
    await db.query("set default_transaction_read_only = on");
    let done = false;
    while (!done && pages < maxBatches && Date.now() - started < budget) {
      const cur = cursorSql(phase, after);
      const {
        rows: [r],
      } = await db.query(CENSUS[phase].sql(cur.sql, cur.params.length + 1), [
        ...cur.params,
        batch,
      ]);
      pages += 1;
      for (const [k, v] of Object.entries(r))
        if (!SKIP.has(k)) carry[phase][k] = (carry[phase][k] ?? 0) + Number(v);
      if (r.scanned > 0) after = CENSUS[phase].cursorOf(r);
      if (r.scanned < batch) {
        const i = PHASES.indexOf(phase);
        if (i === PHASES.length - 1) done = true;
        else {
          phase = PHASES[i + 1];
          after = null;
        }
      }
    }
    const out = {
      done,
      pages,
      phase: done ? null : phase,
      after: done ? null : after,
      counts: carry,
      ms: Date.now() - started,
    };
    if (done) {
      const failures = [];
      for (const p of PHASES) {
        for (const k of MUST_BE_ZERO[p])
          if ((carry[p][k] ?? 0) !== 0) failures.push(`${p}.${k}`);
        if ((carry[p].rows ?? 0) !== (carry[p].elements ?? 0))
          failures.push(`${p}.rows != ${p}.elements`);
      }
      out.pass = failures.length === 0;
      out.failures = failures;
    } else {
      out.next = {
        card_arrays_census: { phase, after, carry, batch, budget_ms: budget },
      };
    }
    return out;
  } finally {
    await db.end();
  }
}
