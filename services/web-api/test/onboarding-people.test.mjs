import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import pg from "pg";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { makeLive } from "../../../packages/tools/src/live.mjs";
import { enqueueJob } from "../../../packages/ledger/src/ledger.mjs";
import {
  onboardingPeople,
  requestOnboardingPeople,
} from "../src/onboarding-people.mjs";
import { onboardingPeopleRoutes } from "../src/routes/onboarding-people.mjs";

const OWN = "#00092VJ2";
const CLAN = "#0U082URG";
let ctx, db, accountId, live;

before(async () => {
  ctx = await scratchDb("onboarding_people");
  db = new pg.Pool({ connectionString: ctx.url, max: 2 });
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, role) values ('onboarding-person', 'approved', 'member') returning account_id`,
  );
  accountId = account.account_id;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Invented Grove')`,
    [CLAN],
  );
  await db.query(
    `insert into player (player_tag, name, last_known_clan_tag) values ($1, 'Invented Player', $2)`,
    [OWN, CLAN],
  );
  await db.query(
    `insert into claim (account_id, player_tag, relationship, is_primary) values ($1, $2, 'primary', true)`,
    [accountId, OWN],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'activity')`,
    [CLAN, accountId],
  );
  live = makeLive({ enqueue: enqueueJob });
});
after(async () => {
  await db?.end();
  await ctx?.drop();
});
beforeEach(async () => {
  await db.query("delete from job");
  await db.query("delete from poll_state");
  await db.query("delete from rate_limit");
  await db.query("delete from account_clan_declined");
  await db.query("delete from account_clan");
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'activity')`,
    [accountId, CLAN],
  );
  await db.query(`update claim set created_at = now() where account_id = $1`, [
    accountId,
  ]);
  await db.query(
    `insert into player_profile_membership (player_tag, state, observed_at) values ($1, 'member', now()) on conflict (player_tag) do update set state = 'member', observed_at = now()`,
    [OWN],
  );
  await db.query("update budget_state set tokens = 10, settled_at = now()");
});
const tokens = async () =>
  Number((await db.query("select tokens from budget_state")).rows[0].tokens);
const allowance = async () =>
  (
    await db.query(
      "select coalesce(sum(count),0)::int as n from rate_limit where bucket like 'onboardingclan#%'",
    )
  ).rows[0].n;

test("a missing primary clan roster queues once, through the shared live budget", async () => {
  const state = await onboardingPeople(db, accountId);
  assert.equal(state.state, "roster");
  assert.equal(state.may_request, true);
  assert.deepEqual(state.clan, { tag: CLAN, name: "Invented Grove" });
  const requested = await requestOnboardingPeople(db, accountId, live);
  assert.equal(requested.queued, true);
  assert.equal(await tokens(), 9);
  assert.equal(await allowance(), 1);
  await requestOnboardingPeople(db, accountId, live);
  assert.equal(
    (await db.query("select count(*)::int as n from job")).rows[0].n,
    1,
  );
  assert.equal(await tokens(), 9);
  const {
    rows: [job],
  } = await db.query("select endpoint, entity_key, lane, record from job");
  assert.deepEqual(job, {
    endpoint: "clan",
    entity_key: CLAN,
    lane: "live",
    record: true,
  });
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at) values ($1, 'clan', now())`,
    [CLAN],
  );
  const ready = await onboardingPeople(db, accountId);
  assert.equal(ready.state, "ready");
  assert.ok(ready.read_at);
  assert.equal(ready.poll_ms, null);
});

test("concurrent tabs mint one roster read and spend one allowance", async () => {
  await Promise.all([
    requestOnboardingPeople(db, accountId, live),
    requestOnboardingPeople(db, accountId, live),
  ]);
  assert.equal(await tokens(), 9);
  assert.equal(await allowance(), 1);
  assert.equal(
    (await db.query("select count(*)::int as n from job")).rows[0].n,
    1,
  );
});

test("an already open roster job is reused without another charge", async () => {
  await enqueueJob(db, { endpoint: "clan", entity_key: CLAN, lane: "live" });
  const requested = await requestOnboardingPeople(db, accountId, live);
  assert.equal(requested.queued, true);
  assert.equal(await tokens(), 10);
  assert.equal(await allowance(), 0);
});

test("a clan follow removed before minting refunds the global token and queues nothing", async () => {
  const result = await requestOnboardingPeople(
    db,
    accountId,
    async (connection, ask) => {
      await connection.query("delete from account_clan");
      return live(connection, ask);
    },
  );
  assert.equal(result.queued, false);
  assert.equal(await tokens(), 10);
  assert.equal(await allowance(), 0);
  assert.equal(
    (await db.query("select count(*)::int as n from job")).rows[0].n,
    0,
  );
});

test("a refund uses the day that paid, even if UTC midnight passed while minting", async () => {
  const paid = new Date("2026-11-16T00:00:00Z");
  let refunded;
  const connection = {
    query: async (sql, values) => {
      if (sql.includes("select c.player_tag"))
        return {
          rows: [
            {
              player_tag: OWN,
              created_at: new Date(),
              last_known_clan_tag: CLAN,
              name: "Grove",
              followed: true,
              spent: false,
            },
          ],
        };
      if (sql.includes("from player p"))
        return {
          rows: [{ player_tag: OWN, state: "member", observed_at: new Date() }],
        };
      if (sql.includes("insert into rate_limit"))
        return { rows: [{ window_start: paid }] };
      refunded = values[1];
      return { rows: [] };
    },
  };
  await requestOnboardingPeople(
    connection,
    accountId,
    async (_connection, { beforeMint }) => {
      await beforeMint();
      return { reason: "pending", minted: false };
    },
  );
  assert.equal(refunded, paid);
});

test("no global token, a failed mint, or a spent allowance never creates extra work", async () => {
  await db.query("update budget_state set tokens = 0");
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).queued,
    false,
  );
  assert.equal(await allowance(), 0);
  await db.query("update budget_state set tokens = 10");
  await requestOnboardingPeople(db, accountId, async (_db, { beforeMint }) => {
    await beforeMint();
    throw new Error("fixture enqueue failure");
  });
  assert.equal(await allowance(), 0);
  await requestOnboardingPeople(db, accountId, live);
  await db.query("update job set status = 'dead'");
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).queued,
    false,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from job")).rows[0].n,
    1,
  );
});

test("a delayed first profile starts its opportunity when it arrives; later profiles do not extend a requested roster", async () => {
  await db.query("update claim set created_at = now() - interval '10 minutes'");
  assert.equal((await onboardingPeople(db, accountId)).may_request, true);
  await requestOnboardingPeople(db, accountId, live);
  await db.query("update job set created_at = now() - interval '5 minutes'");
  await db.query("update player_profile_membership set observed_at = now()");
  const waiting = await onboardingPeople(db, accountId);
  assert.equal(waiting.may_request, false);
  assert.equal(waiting.poll_ms, 60_000);
  await db.query("update claim set created_at = now() - interval '2 days'");
  assert.equal((await onboardingPeople(db, accountId)).state, "finished");
});

test("unknown profile, no clan, declined clan and no existing clan slot never mint a read", async () => {
  await db.query("delete from player_profile_membership");
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).state,
    "profile",
  );
  await db.query(
    `insert into player_profile_membership (player_tag, state, observed_at) values ($1, 'none', now())`,
    [OWN],
  );
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).state,
    "no_clan",
  );
  await db.query("update player_profile_membership set state = 'member'");
  await db.query(
    `insert into account_clan_declined (account_id, clan_tag) values ($1, $2)`,
    [accountId, CLAN],
  );
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).state,
    "unfollowed",
  );
  await db.query("delete from account_clan_declined");
  await db.query("delete from account_clan");
  assert.equal(
    (await requestOnboardingPeople(db, accountId, live)).queued,
    false,
  );
  assert.equal(await tokens(), 10);
  assert.equal(await allowance(), 0);
  assert.equal(
    (await db.query("select count(*)::int as n from job")).rows[0].n,
    0,
  );
});

test("the progress route is person-only and never accepts another subject", async () => {
  for (const account of [null, { accountId, kind: "agent" }]) {
    const routes = onboardingPeopleRoutes({
      resolveAccount: async () => account,
      live,
    });
    for (const method of ["GET", "POST"]) {
      const response = await routes[`${method} /api/me/people/onboarding`](
        db,
        {},
        { player_tag: "#00JRG2RU", clan_tag: "#J2RGCRVG" },
      );
      assert.equal(response.statusCode, account ? 403 : 401);
    }
  }
  const routes = onboardingPeopleRoutes({
    resolveAccount: async () => ({ accountId, kind: "person" }),
    live,
  });
  const response = await routes["POST /api/me/people/onboarding"](
    db,
    {},
    { clan_tag: "#J2RGCRVG" },
  );
  assert.equal(response.statusCode, 200);
  assert.equal(
    (await db.query("select entity_key from job")).rows[0].entity_key,
    CLAN,
  );
});

test("the progress read uses bounded live-clan history beside a retained ledger", async () => {
  await db.query(
    `insert into job (endpoint, entity_key, lane, status, created_at, done_at)
     select case when n % 100 = 0 then 'clan' else 'player' end,
            'retained-' || n,
            case when n % 100 = 0 then 'live' else 'bulk' end,
            'done', now() - interval '1 day', now()
       from generate_series(1, 20000) n`,
  );
  await db.query(
    `insert into job (endpoint, entity_key, lane, status, done_at)
     values ('clan', $1, 'live', 'done', now())`,
    [CLAN],
  );
  await db.query("analyze job");
  let plan;
  await onboardingPeople(
    {
      query: async (sql, values) => {
        if (sql.includes("select c.player_tag"))
          plan = (await db.query(`explain (format json) ${sql}`, values))
            .rows[0]["QUERY PLAN"][0].Plan;
        return db.query(sql, values);
      },
    },
    accountId,
  );
  const nodes = (node) => [node, ...(node.Plans ?? []).flatMap(nodes)];
  const history = nodes(plan).find(
    (node) => node["Index Name"] === "job_live_clan_history",
  );
  assert.ok(history, JSON.stringify(plan));
  assert.match(history["Index Cond"], /entity_key/);
  assert.match(history["Index Cond"], /created_at/);
});
