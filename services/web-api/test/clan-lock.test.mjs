// The clan's lock, narrowed (2026-11-13): an evaluation reads the record
// holding no lock and changes the ledger only inside `exclusive`, the
// web API's session advisory lock. On scratch Postgres with the real
// ledger, two connections and the manage service; the record is a
// scripted door that parks each participation read on a barrier, so
// every interleaving here is forced, never timed.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "../../../packages/clan-engine/test/fixture.mjs";
import { rosterBody } from "../../../packages/clan/test/fakes.mjs";
import { createManageService } from "@elixir-mcp/clan/manage/service.mjs";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { clanExclusive, clanLockKey, clanLockPlan } from "../src/clan.mjs";

const CLAN = "#2PQRJ8LV";
const king = member("#20QQL8CCRU", { name: "Ada", role: "leader" });
const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
const idle = member("#8QCV", {
  name: "Sleepy",
  lastBattleDaysAgo: 20,
  war: [0, 0, 0, 0, 0, 0],
});
const part = participation([king, ...others, idle], {
  clan_tag: CLAN,
  name: "Example Clan",
});
const LEADER = { player_tag: king.player_tag, role: "leader", verified: true };

let scratch, one, two, watcher;
before(async () => {
  scratch = await scratchDb("clan_lock");
  one = new pg.Client({ connectionString: scratch.url });
  two = new pg.Client({ connectionString: scratch.url });
  watcher = new pg.Client({ connectionString: scratch.url });
  await Promise.all([one.connect(), two.connect(), watcher.connect()]);
});
after(async () => {
  await Promise.all([one?.end(), two?.end(), watcher?.end()]);
  await scratch?.drop();
});
beforeEach(async () => {
  await scratch.db.query("truncate clan_state");
  await createPostgresLedger(scratch.db).savePolicy(CLAN, {
    values: EXAMPLE_POLICY,
    by: king.player_tag,
    by_name: king.name,
    note: null,
  });
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** The record as the manage service reads it; `onParticipation` runs
 *  inside each participation read, before it answers. */
function door(onParticipation = async () => {}) {
  return {
    async callTool(_token, name) {
      if (name === "clans_participation") {
        await onParticipation();
        return { ok: true, body: structuredClone(part) };
      }
      if (name === "clans_roster")
        return {
          ok: true,
          body: rosterBody(
            part.members.map((m) => ({
              player_tag: m.player_tag,
              name: m.name,
              role: m.role,
              trophies: 9000,
            })),
          ),
        };
      return { ok: false, status: 502, error: "not scripted" };
    },
  };
}

/** The manage service on one connection, locking as the web API does. */
function service(db, mcp, t = NOW.getTime()) {
  return createManageService({
    ledger: createPostgresLedger(db),
    mcp,
    now: () => t,
    exclusive: clanExclusive(db),
    activityFor: async (_tag, tags) =>
      new Map(
        part.members
          .filter((m) => tags.includes(m.player_tag))
          .map((m) => [
            m.player_tag,
            {
              ...m,
              activity_evidence: {
                ...m.activity_evidence,
                observations: m.activity_evidence.observations.map(
                  (r, i, rows) =>
                    i === rows.length - 1
                      ? { ...r, profile_observed_at: new Date(t).toISOString() }
                      : r,
                ),
              },
            },
          ]),
      ),
  });
}

const removals = async () =>
  (await createPostgresLedger(scratch.db).cards(CLAN)).filter(
    (c) => c.type === "removal" && c.player_tag === idle.player_tag,
  );

/** Whether a connection is waiting for the clan's lock right now. */
const lockWaiter = async () =>
  (
    await watcher.query(
      `select exists(select 1 from pg_locks
        where locktype = 'advisory' and not granted
          and database = (select oid from pg_database where datname = current_database())
          and objid = (hashtext($1)::bigint & 4294967295)) as waiting`,
      [clanLockKey(CLAN)],
    )
  ).rows[0].waiting;

test("two evaluations that read the record together raise each Action once", async () => {
  // Both participation reads must have started before either answers:
  // both evaluations judge from the same empty ledger snapshot unless the
  // locked half reads the cards again.
  let arrived = 0;
  const both = deferred();
  const mcp = door(async () => {
    if (++arrived === 2) both.resolve();
    await both.promise;
  });
  const [a, b] = await Promise.all([
    service(one, mcp).evaluateClan({
      clanTag: CLAN,
      token: "t",
      who: LEADER,
      force: true,
    }),
    service(two, mcp).evaluateClan({
      clanTag: CLAN,
      token: "t",
      who: LEADER,
      force: true,
    }),
  ]);
  assert.equal(arrived, 2);
  const cards = await removals();
  assert.equal(cards.length, 1, "one removal Action, not one per evaluation");
  assert.equal(cards[0].status, "proposed");
  const ledger = createPostgresLedger(scratch.db);
  const all = await ledger.cards(CLAN);
  assert.equal(
    new Set(all.map((c) => `${c.type}|${c.player_tag}`)).size,
    all.length,
    "no Action raised twice",
  );
  assert.equal(
    new Set(all.map((c) => c.number)).size,
    all.length,
    "every Action has its own number",
  );
  const raised = (await ledger.actionLog(CLAN, cards[0].card_id)).filter(
    (e) => e.kind === "raised",
  );
  assert.equal(raised.length, 1);
  assert.ok(
    a.verdicts.members.length === 12 && b.verdicts.members.length === 12,
  );
});

test("an evaluation that read the record earlier takes a later one's snapshot", async () => {
  const early = deferred();
  const parked = deferred();
  const slow = service(
    one,
    door(async () => {
      parked.resolve();
      await early.promise;
    }),
    NOW.getTime(),
  );
  const pending = slow.evaluateClan({
    clanTag: CLAN,
    token: "t",
    who: LEADER,
    force: true,
  });
  await parked.promise;
  // A later evaluation reads and applies while the first is still reading.
  const later = await service(two, door(), NOW.getTime() + 1000).evaluateClan({
    clanTag: CLAN,
    token: "t",
    who: LEADER,
    force: true,
  });
  assert.equal(later.cached, false);
  early.resolve();
  const first = await pending;
  assert.equal(first.cached, true);
  assert.equal(first.verdicts.evaluated_at, later.verdicts.evaluated_at);
  assert.equal((await removals()).length, 1);
});

test("a decision made while an evaluation reads the record stands", async () => {
  await service(one, door()).evaluateClan({
    clanTag: CLAN,
    token: "t",
    who: LEADER,
    force: true,
  });
  const [card] = await removals();
  assert.equal(card.status, "proposed");
  const release = deferred();
  const parked = deferred();
  const pending = service(
    one,
    door(async () => {
      parked.resolve();
      await release.promise;
    }),
    NOW.getTime() + 60_000,
  ).evaluateClan({ clanTag: CLAN, token: "t", who: LEADER, force: true });
  await parked.promise;
  // The evaluation is reading the record and holds no lock: a write on
  // another connection takes the clan's lock and decides at once.
  const decidedAt = new Date(NOW.getTime() + 30_000).toISOString();
  const ledger = createPostgresLedger(two);
  const decided = await clanExclusive(two)(CLAN, async () =>
    ledger.updateCardIf(CLAN, await ledger.card(CLAN, card.card_id), {
      status: "done",
      decided_at: decidedAt,
      decided_by: king.player_tag,
      decided_by_name: king.name,
    }),
  );
  assert.ok(decided);
  release.resolve();
  await pending;
  const after = await removals();
  assert.equal(after.length, 1, "the decided removal is not raised again");
  assert.equal(after[0].status, "done");
  assert.equal(after[0].decided_by, king.player_tag);
  assert.equal(after[0].decided_at, decidedAt);
});

test("the locked half waits for the clan's lock; the record reads do not", async () => {
  const key = clanLockKey(CLAN);
  await watcher.query("select pg_advisory_lock(hashtext($1))", [key]);
  const read = deferred();
  let settled = false;
  let pending;
  try {
    pending = service(
      one,
      door(async () => read.resolve()),
    )
      .evaluateClan({ clanTag: CLAN, token: "t", who: LEADER, force: true })
      .finally(() => (settled = true));
    // The participation read runs while another holder has the lock.
    await read.promise;
    // Then the evaluation queues for the lock: observed, not assumed.
    while (!(await lockWaiter())) await new Promise((r) => setImmediate(r));
    assert.equal(settled, false);
    assert.equal((await removals()).length, 0, "nothing written while waiting");
  } finally {
    await watcher.query("select pg_advisory_unlock(hashtext($1))", [key]);
  }
  await pending;
  assert.equal((await removals()).length, 1);
});

test("which Clan requests hold the clan's lock for the whole request", () => {
  const plan = (method, rest) =>
    clanLockPlan(method, `/api/clan/clans/9GQLVO0${rest}`, 7);
  const key = "clan-state:#9GQLV00";
  for (const rest of [
    "/actions",
    "/actions/37",
    "/manage",
    "/history",
    "/policy",
    "/standing",
    "/awards",
    "/awards/manage",
    "/trophies",
  ])
    assert.deepEqual(plan("GET", rest), {
      clan: "#9GQLV00",
      request: null,
      share: true,
    });
  assert.deepEqual(plan("POST", "/policy/preview").request, null);
  for (const rest of ["/week", "/season", "/me", "/home", "/needs", "/feed"])
    assert.deepEqual(plan("GET", rest), {
      clan: "#9GQLV00",
      request: null,
      share: false,
    });
  // Every write, and the reads not narrowed, keep the request lock.
  for (const [method, rest] of [
    ["POST", "/policy"],
    ["POST", "/actions/abc/decide"],
    ["POST", "/actions/abc/draft"],
    ["POST", "/awards/grants"],
    ["PUT", "/me/away"],
    ["GET", "/recruit"],
    ["GET", "/sharing"],
  ])
    assert.equal(plan(method, rest).request, key, `${method} ${rest}`);
  assert.equal(
    clanLockPlan("POST", "/api/clan/select", 7).request,
    "clan-state:7",
  );
  assert.equal(clanLockPlan("GET", "/api/clan/me", 7).request, null);
});
