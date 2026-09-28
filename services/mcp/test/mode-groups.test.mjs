/**
 * Event classification (#109, Jamie 2026-09-28). A clanmate battle
 * (`clanMate`, `clanMate2v2`) is casual even when it carries an event
 * tag; any other tagged battle is event content, the API's `unknown`
 * included (Royale Shuffle); an untagged `unknown` stays casual.
 *
 * modeGroupOf (JS) put every tagged battle in `event` and its SQL twin
 * did the same, so tagged clanmate friendlies were filed as events, and
 * `group_by: game_mode` keyed rows on the (game_mode, type) slot, which
 * Supercell reuses across events, so one row pooled several.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  MODE_GROUP_BY_TYPE,
  MODE_GROUPS,
  modeGroupOf,
  modeGroupSql,
} from "@elixir-mcp/contracts";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { refreshDailyRollups } from "../../ingest/src/rollups.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { participantModeClause } from "../src/mode-filter.mjs";

let scratch;
let account;
const registry = makeRegistry();
const P = "#2PYLQG0";
const OPP = "#2PYLQG8";
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

// Every type the fold knows, and two it does not (the API's odd values).
const TYPES = [...Object.keys(MODE_GROUP_BY_TYPE), "casual1v1", "None"];
const TAG = "#EVENTTAG1";

before(async () => {
  scratch = await scratchDb("mode_groups");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('mode-groups','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const tag of [P, OPP])
    await scratch.db.query("insert into player (player_tag) values ($1)", [
      tag,
    ]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [P, account.accountId],
  );
});

after(async () => {
  await scratch?.drop();
});

let n = 0;
async function battle({
  type,
  tag = null,
  gameMode = "Friendly",
  at,
  outcome = "win",
}) {
  const id = `mg-${String(++n).padStart(4, "0")}`;
  const typeClass = type === "boatBattle" ? "boat" : "pvp";
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name, event_tag)
     values ($1, $2::timestamptz, $3, $4, $5, $6)`,
    [id, at, type, typeClass, gameMode, tag],
  );
  await scratch.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class, crowns)
     values ($1, $2, 0, $3, $4::timestamptz, $5, $6, 1),
            ($1, $7, 1, $8, $4::timestamptz, $5, $6, 0)`,
    [
      id,
      P,
      outcome,
      at,
      type,
      typeClass,
      OPP,
      outcome === "win" ? "loss" : "win",
    ],
  );
  return id;
}

test("the JS and SQL folds give one answer for every type, tagged and untagged", async () => {
  const cases = TYPES.flatMap((t) => [
    [t, null],
    [t, TAG],
  ]);
  const { rows } = await scratch.db.query(
    `select v.t, v.g, ${modeGroupSql("v.t", "v.g")} as grp
       from unnest($1::text[], $2::text[]) as v(t, g)`,
    [cases.map((c) => c[0]), cases.map((c) => c[1])],
  );
  assert.equal(rows.length, cases.length);
  for (const r of rows)
    assert.equal(
      r.grp,
      modeGroupOf(r.t, r.g),
      `${r.t} ${r.g ? "tagged" : "untagged"}: SQL ${r.grp}, JS ${modeGroupOf(r.t, r.g)}`,
    );
});

test("Jamie's ruling: clanmate battles are casual even tagged; a tagged unknown is an event", () => {
  assert.equal(modeGroupOf("clanMate", TAG), "casual");
  assert.equal(modeGroupOf("clanMate2v2", TAG), "casual");
  assert.equal(modeGroupOf("unknown", TAG), "event");
  assert.equal(modeGroupOf("unknown", null), "casual");
  assert.equal(modeGroupOf("trail", TAG), "event");
  assert.equal(modeGroupOf("friendly", TAG), "event");
  assert.equal(modeGroupOf("PvP", null), "ladder");
});

test("every mode filter selects exactly the battles its group names", async () => {
  // One battle per mapped type, tagged and untagged, on distinct days.
  const seeded = new Map();
  let i = 0;
  for (const type of Object.keys(MODE_GROUP_BY_TYPE))
    for (const tag of [null, TAG]) {
      const at = new Date(Date.UTC(2026, 7, 1, 12) + i++ * 3600_000);
      const id = await battle({ type, tag, at: at.toISOString() });
      seeded.set(id, modeGroupOf(type, tag));
    }
  const from = "2026-08-01";
  const to = "2026-08-05";
  for (const mode of MODE_GROUPS) {
    const want = [...seeded]
      .filter(([, g]) => g === mode)
      .map(([id]) => id)
      .sort();
    // battles_query: the battle tools' shared modeClause.
    const q = await call("battles_query", {
      player_tag: P,
      mode,
      from,
      to,
      limit: 25,
    });
    const got = q.battles.map((b) => b.battle_id).sort();
    assert.deepEqual(got, want, `battles_query mode ${mode}`);
    assert.ok(
      q.battles.every((b) => b.mode_group === mode),
      `battles_query mode ${mode}: every row is labelled ${mode}`,
    );
    // The participant-only filter (trends, the card profile, synergy).
    const params = [P];
    const { rows } = await scratch.db.query(
      `select bp.battle_id from battle_participant bp
        where bp.player_tag = $1 and bp.battle_id like 'mg-%'
          and ${participantModeClause(mode, params)}
        order by 1`,
      params,
    );
    assert.deepEqual(
      rows.map((r) => r.battle_id),
      want,
      `participantModeClause ${mode}`,
    );
  }
});

test("the daily rollup files a tagged clanmate battle under casual, a tagged unknown under event", async () => {
  const day = "2026-08-10";
  await battle({ type: "clanMate", tag: TAG, at: `${day}T12:00:00Z` });
  await battle({ type: "clanMate2v2", tag: TAG, at: `${day}T12:10:00Z` });
  await battle({ type: "unknown", tag: TAG, at: `${day}T12:20:00Z` });
  await battle({ type: "unknown", at: `${day}T12:30:00Z` });
  await refreshDailyRollups(scratch.db, [{ playerTag: P, day }]);
  const { rows } = await scratch.db.query(
    `select mode_group, sum(battles_captured)::int as n
       from player_daily_battle_rollup where player_tag = $1 and day = $2
      group by 1 order by 1`,
    [P, day],
  );
  assert.deepEqual(rows, [
    { mode_group: "casual", n: 3 },
    { mode_group: "event", n: 1 },
  ]);
});

test("group_by game_mode gives one row per event, titled, and never pools two", async () => {
  // Two events on the same (game_mode, type) slot, one sighted by the
  // events read and one never sighted; a clanmate friendly under the
  // first event's rules; and an untagged battle in the same mode.
  const A = "#EVENTA";
  const B = "#EVENTB";
  await scratch.db.query(
    `insert into game_event (event_tag, title, first_seen_at, last_seen_at)
     values ($1, 'Royale Shuffle', '2026-09-01', '2026-09-02')`,
    [A],
  );
  const base = Date.UTC(2026, 8, 1, 12);
  const at = (h) => new Date(base + h * 3600_000).toISOString();
  await battle({ type: "unknown", tag: A, gameMode: "TeamVsTeam", at: at(0) });
  await battle({
    type: "unknown",
    tag: A,
    gameMode: "TeamVsTeam",
    at: at(1),
    outcome: "loss",
  });
  await battle({ type: "unknown", tag: B, gameMode: "TeamVsTeam", at: at(2) });
  await battle({
    type: "clanMate2v2",
    tag: A,
    gameMode: "TeamVsTeam",
    at: at(3),
  });
  await battle({ type: "unknown", gameMode: "TeamVsTeam", at: at(4) });

  const r = await call("battles_performance", {
    player_tag: P,
    from: "2026-09-01",
    to: "2026-09-02",
    group_by: "game_mode",
  });
  const key = (m) => `${m.type}|${m.event_tag ?? "-"}`;
  const rows = Object.fromEntries(r.by_mode.map((m) => [key(m), m]));
  assert.equal(r.by_mode.length, 4, JSON.stringify(r.by_mode));
  assert.deepEqual(
    {
      tag: rows[`unknown|${A}`].event_tag,
      title: rows[`unknown|${A}`].event_title,
      battles: rows[`unknown|${A}`].battles,
      wins: rows[`unknown|${A}`].wins,
    },
    { tag: A, title: "Royale Shuffle", battles: 2, wins: 1 },
  );
  assert.equal(rows[`unknown|${B}`].event_title, null, "never sighted");
  assert.equal(rows[`unknown|${B}`].battles, 1);
  // The clanmate friendly is casual: no event key, beside the untagged row.
  assert.equal(rows["clanMate2v2|-"].event_tag, null);
  assert.equal(rows["clanMate2v2|-"].event_title, null);
  assert.equal(rows["unknown|-"].battles, 1);

  // mode event, grouped: only the event rows, each its own, and no
  // "pools every event" note, since nothing is pooled.
  const ev = await call("battles_performance", {
    player_tag: P,
    from: "2026-09-01",
    to: "2026-09-02",
    group_by: "game_mode",
    mode: "event",
  });
  assert.deepEqual(ev.by_mode.map((m) => m.event_tag).sort(), [A, B]);
  assert.ok(!ev.notes.some((x) => /pools every event/.test(x)));
  // Ungrouped, the pooled rate still says it pools.
  const pooled = await call("battles_performance", {
    player_tag: P,
    from: "2026-09-01",
    to: "2026-09-02",
    mode: "event",
  });
  assert.ok(pooled.notes.some((x) => /pools every event/.test(x)));
});
