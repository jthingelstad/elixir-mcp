/**
 * Who hears about a player, and why.
 *
 * Before this, the only route into a feed was a CLAIM, and the player-stream
 * fan-out function was never called in production at all -- so no badge or
 * milestone had ever reached anybody. The routing question the principal kinds
 * opened is here: an agent's "me" is the clan it runs, so it must hear about
 * the clan's players WITHOUT holding fifty claims of its own, while an
 * integration -- which has no "me" at all -- hears nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx, gatewayId, meta, tag, clanTag;
let person, agent, integration, bystander;

const message = ({ endpoint, entityKey, payload, fetchedAt }) => ({
  v: 1,
  job: { endpoint, entity_key: entityKey, lane: "bulk" },
  gateway_id: gatewayId,
  fetched_at: fetchedAt,
  status: "ok",
  body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
    "base64",
  ),
});

const feedOf = async (accountId, topic) => {
  const { rows } = await ctx.db.query(
    `select topic, subject_tag, payload from event_feed
      where account_id = $1 and topic = $2 order by event_id`,
    [accountId, topic],
  );
  return rows;
};

async function makeAccount(kind, { hash, owner = null }) {
  const {
    rows: [a],
  } = await ctx.db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id)
     values ($1, 'approved', 'member', $2, $3) returning account_id`,
    [hash, kind, owner],
  );
  return a.account_id;
}

before(async () => {
  ctx = await scratchDb("feedfanout");
  meta = await fixtureMeta();
  tag = meta["player/profile.json"].entity_key;
  const profile = await fixture("player/profile.json");
  clanTag = profile.clan.tag;

  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'fan-gw', '127.0.0.1', 'active') returning gateway_id`,
    [await makeAccount("person", { hash: "fan-owner" })],
  );
  gatewayId = gw.gateway_id;

  person = await makeAccount("person", { hash: "fan-person" });
  agent = await makeAccount("agent", { hash: null, owner: person });
  integration = await makeAccount("integration", { hash: null, owner: person });
  // Adds the CLAN but is not an agent: watching a clan is not a standing
  // order for fifty players' badge shelves.
  bystander = await makeAccount("person", { hash: "fan-bystander" });

  await ctx.db.query(
    `insert into player (player_tag, first_seen_at, last_seen_at)
     values ($1, now(), now()) on conflict do nothing`,
    [tag],
  );
  await ctx.db.query(
    `insert into clan (clan_tag, first_seen_at, last_seen_at)
     values ($1, now(), now()) on conflict do nothing`,
    [clanTag],
  );
  await ctx.db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, now(), 'member')`,
    [clanTag, tag],
  );
  await ctx.db.query(
    `insert into claim (account_id, player_tag, notify) values ($1, $2, true)`,
    [person, tag],
  );
  for (const acct of [agent, integration, bystander])
    await ctx.db.query(
      `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
      [acct, clanTag],
    );
});

after(async () => ctx.drop());

test("a player's first sighting nods to nobody", async () => {
  // The whole badge shelf is 'new' on first contact. elixir-bot names this its
  // flood class; with fifty tracked players it is the difference between a
  // feed and an outage.
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: await fixture("player/profile.json"),
      fetchedAt: "2026-09-01T10:00:00Z",
    }),
  );
  for (const acct of [person, agent, bystander]) {
    assert.equal((await feedOf(acct, "badge_earned")).length, 0);
    assert.equal((await feedOf(acct, "legendary_badge_earned")).length, 0);
  }
});

test("a badge that levels up reaches the claimant AND the clan's agent", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.badges.find((b) => b.name === "MasteryWitch").level += 1;
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-02T10:00:00Z",
    }),
  );

  const claimed = await feedOf(person, "badge_earned");
  assert.equal(claimed.length, 1, "the claimant hears about it");
  assert.equal(claimed[0].subject_tag, tag);
  assert.equal(claimed[0].payload.count, 1);

  // The point of the whole change: no claim, heard anyway, via the clan.
  const viaClan = await feedOf(agent, "badge_earned");
  assert.equal(viaClan.length, 1, "the agent hears via clan membership");

  assert.equal(
    (await feedOf(integration, "badge_earned")).length,
    0,
    "an integration has no 'me' and hears nothing",
  );
  assert.equal(
    (await feedOf(bystander, "badge_earned")).length,
    0,
    "adding a clan is not a subscription to every member's milestones",
  );
});

test("a one-off badge is its own topic, never a field on the routine one", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  // No level = awarded once and never again (elixir-bot's badge_tier rule).
  profile.badges.push({ name: "Chaos_S2" });
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-03T10:00:00Z",
    }),
  );
  const legendary = await feedOf(person, "legendary_badge_earned");
  assert.equal(legendary.length, 1);
  assert.equal(legendary[0].payload.count, 1);
});

test("many milestones on one tag fold into one nod with a running count", async () => {
  const before = (await feedOf(person, "badge_earned")).length;
  const profile = structuredClone(await fixture("player/profile.json"));
  for (const name of ["MasteryWitch", "MasteryMiner", "BattleWins"])
    profile.badges.find((b) => b.name === name).level += 5;
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-04T10:00:00Z",
    }),
  );
  const rows = await feedOf(person, "badge_earned");
  assert.equal(rows.length, before, "folded into the existing unread row");
  assert.ok(
    rows.at(-1).payload.count >= 3,
    `count accumulates: ${rows.at(-1).payload.count}`,
  );
});

test("snapshot milestones nod, and carry no analysis", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.bestTrophies += 40;
  profile.collectionLevel += 1;
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-05T10:00:00Z",
    }),
  );
  const peak = await feedOf(person, "best_trophies_peak");
  assert.equal(peak.length, 1);
  // A nod, not a report: the reader drills with players_profile.
  assert.deepEqual(Object.keys(peak[0].payload), ["count"]);
  assert.equal((await feedOf(person, "collection_level_milestone")).length, 1);
  assert.equal(
    (await feedOf(agent, "best_trophies_peak")).length,
    1,
    "the agent gets snapshot milestones through the clan too",
  );
});
