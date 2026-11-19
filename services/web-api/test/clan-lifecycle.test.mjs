import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { ingestClanRoster } from "../../../packages/ingest/src/roster.mjs";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { createManageService } from "@elixir-mcp/clan/manage/service.mjs";
import { writeClanFactInClan } from "@elixir-mcp/record/attested-facts";
import { createLifecycle } from "@elixir-mcp/clan/manage/lifecycle.mjs";
import { draftStory } from "@elixir-mcp/syndication";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { postableMoment } from "@elixir-mcp/posts/moment";
import { setCheer } from "../src/cheers.mjs";
import { cheersFor } from "@elixir-mcp/tools/activity/cheers";

test("one stay through welcome, promotion, demotion, classified departure and return", async (t) => {
  const ctx = await scratchDb("member_lifecycle");
  t.after(() => ctx.drop());
  const db = ctx.db,
    ledger = createPostgresLedger(db);
  const clan = "#0GJJ9QJL",
    tag = "#0QYPJ8G2",
    elder = "#0LCRV2PQ";
  const leader = {
    role: "leader",
    verified: true,
    player_tag: elder,
    name: "Ash",
  };
  const life = createLifecycle(db, ledger, {
    attest: (tag, body) =>
      writeClanFactInClan(db, { kind: "person", accountId: seat }, tag, body, {
        inTransaction: true,
      }),
    storyFor: (clan, tags, opts) => draftStory(db, clan, tags, opts),
  });
  let time = Date.now() - 3600000;
  const manage = createManageService({
    ledger,
    record: {},
    lifecycle: life,
    now: () => time,
  });
  const who = async (hash) =>
    (
      await db.query(
        "insert into account(email_hash,status) values($1,'approved') returning account_id",
        [hash],
      )
    ).rows[0].account_id;
  const seat = await who("lifecycle-clan"),
    outside = await who("lifecycle-friend");
  await db.query(
    "insert into recording(subject_type,subject_tag,requested_by,status,scope) values('clan',$1,$2,'active','comprehensive')",
    [clan, seat],
  );
  const roster = async (role) => {
    time += 60000;
    const members = [
      { tag: elder, name: "Ash", role: "leader" },
      ...Array.from({ length: 9 }, (_, i) => ({
        tag: [
          "#0PLUG2V9",
          "#0PYLQ2",
          "#0GRJCUV",
          "#0Q2L8",
          "#0YY9P",
          "#0PQ2VY",
          "#0CU8LG",
          "#0LUVR2",
          "#0C2C8",
        ][i],
        name: "Clanmate",
        role: "member",
      })),
    ];
    if (role) members.push({ tag, name: "Pip", role });
    await db.query("begin");
    try {
      await ingestClanRoster(db, {
        payload: { tag: clan, name: "Ember Hall", memberList: members },
        observedAt: new Date(time).toISOString(),
      });
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };
  const scan = (subjects, accountId) =>
    buildTimeline(db, subjects, {
      fromMs: time - 7200000,
      toMs: time + 1000,
      accountId,
      interactive: true,
      clanStories: true,
    });
  const c = [{ kind: "clan", tag: clan }],
    p = [{ kind: "player", tag }];
  const find = async (subjects, accountId, kind) =>
    (await scan(subjects, accountId)).timeline.filter((i) => i.kind === kind);
  const card = async (type) =>
    (await ledger.cards(clan))
      .filter((c) => c.type === type && c.status === "proposed")
      .at(-1);
  await roster(null);
  assert.equal(await life.drain(), 0);
  await db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values($1,$2,'verified',true,'primary')",
    [seat, elder],
  );
  await ledger.savePolicy(clan, {
    values: { welcome_enabled: true, departures_enabled: true },
    by: elder,
  });
  await roster("member");
  assert.equal(await life.drain(), 1);
  const introduction = await card("welcome");
  const [publicJoin] = await find(p, outside, "clan_joined");
  const [join] = await find([...p, ...c], seat, "member_joined");
  assert.equal(join.id, publicJoin.id);
  assert.deepEqual(join.clan_story.lines, introduction.lifecycle.lines);
  assert.equal(publicJoin.clan_story, undefined);
  assert.ok(postableMoment(publicJoin));
  await setCheer(db, seat, join.id, "wow", join);
  assert.equal((await cheersFor(db, [join.id], outside)).size, 1);
  for (const part of [1, 1, 2])
    await manage.shareLifecycle(clan, leader, introduction.card_id, { part });
  assert.equal(
    (await ledger.card(clan, introduction.card_id)).lifecycle.receipts.length,
    2,
  );
  const raise = async (type) => {
    const id = "recommend_" + type + "_" + time;
    const raised_at = new Date(time).toISOString();
    const lifecycle = await life.prepare(clan, tag, type, "Pip", raised_at);
    await ledger.putCard(clan, {
      card_id: id,
      clan_tag: clan,
      player_tag: tag,
      player_name: "Pip",
      type,
      status: "proposed",
      raised_at,
      evidence: {},
      lifecycle,
    });
    return id;
  };
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from attested_fact where fact_type='clan_message'",
      )
    ).rows[0].n,
    2,
  );
  const verdict = async (eligible) =>
    ledger.saveVerdicts(clan, {
      policy_version: 1,
      removal_evidence_schema: 5,
      evaluated_at: new Date(time).toISOString(),
      members: [{ player_tag: tag, actionable: { promotion: eligible } }],
    });
  const promo = await raise("promotion");
  await verdict(false);
  await assert.rejects(
    manage.decide(clan, leader, promo, { status: "done" }),
    (e) => e.code === "recommendation_changed",
  );
  await verdict(true);
  time += 1000;
  const lines = ["Congratulations, Pip!", "Thanks for stepping up as Elder."];
  await manage.decide(clan, leader, promo, { status: "done", tribute: lines });
  const [reported] = await find(c, seat, "member_role_changed");
  assert.deepEqual(reported.clan_story.lines, lines);
  assert.equal(reported.visibility, "clan");
  assert.equal((await find(p, outside, "member_role_changed")).length, 0);
  await setCheer(db, seat, reported.id, "wow", reported);
  await roster("elder");
  assert.equal(await life.drain(), 1);
  const [confirmed] = await find(p, outside, "member_role_changed");
  assert.equal(confirmed.id, reported.id);
  assert.ok(postableMoment(confirmed));
  assert.equal((await cheersFor(db, [reported.id], outside)).size, 0);
  assert.equal((await cheersFor(db, [reported.id], seat)).size, 1);
  await manage.shareLifecycle(clan, leader, promo, { skip: true });
  await roster("member");
  assert.equal(await life.drain(), 1);
  assert.equal((await find(p, outside, "member_role_changed")).length, 1);
  const demotion = await card("demotion");
  assert.equal(demotion.lifecycle.phase, "sharing");
  await roster(null);
  assert.equal(await life.drain(), 1);
  const departure = await card("departure");
  await manage.decide(clan, leader, departure.card_id, {
    classification: "kick",
  });
  const [exit] = await find(c, seat, "member_left");
  assert.match(exit.clan_story.lines[0], /was removed/);
  const [neutral] = await find(p, outside, "clan_left");
  assert.equal(exit.id, neutral.id);
  assert.doesNotMatch(neutral.text, /kick|removed/);
  await roster("member");
  await life.drain();
  const back = await card("welcome");
  assert.match(back.lifecycle.lines[0], /Welcome back/);
  assert.notEqual(back.card_id, introduction.card_id);
  await assert.rejects(
    manage.shareLifecycle(clan, leader, departure.card_id, { part: 1 }),
  );
  await roster(null);
  await life.drain();
  const second = await card("departure");
  assert.notEqual(second.card_id, departure.card_id);
  await manage.decide(clan, leader, second.card_id, {
    classification: "leave",
  });
  const exits = await find(c, seat, "member_left");
  assert.equal(exits.length, 2);
  assert.match(exits[0].clan_story.lines[0], /left/);

  await roster("member");
  await life.drain();
  const direct = await raise("promotion");
  await roster("elder");
  await life.drain();
  const attached = await ledger.card(clan, direct);
  assert.equal(attached.lifecycle.phase, "decision");
  await manage.decide(clan, leader, direct, { status: "done", tribute: lines });
  const promotions = await find(p, outside, "member_role_changed");
  assert.equal(promotions.length, 2);
  assert.notEqual(promotions[0].id, confirmed.id);
  await roster(null);
  await life.drain();
  const ignored = await card("departure");
  await manage.decide(clan, leader, ignored.card_id, {
    classification: "ignore",
  });
  assert.equal(
    (await ledger.card(clan, ignored.card_id)).lifecycle.phase,
    "ignored",
  );
  assert.match(
    (await find(c, seat, "member_left"))[0].clan_story.lines[0],
    /no longer/,
  );

  await roster("member");
  await life.drain();
  const removal = await ledger.card(clan, await raise("removal"));
  const decided = {
    status: "done",
    decided_at: new Date(time).toISOString(),
    decided_by: elder,
    decided_by_name: "Ash",
  };
  await life.confirm(clan, removal, decided, { hours: 24 });
  const [notice] = await find(c, seat, "member_left");
  assert.equal(notice.clan_story.reported_only, true);
  assert.equal((await find(p, outside, "clan_left")).length, 3);
  await roster(null);
  await life.drain();
  assert.equal((await find(p, outside, "clan_left"))[0].id, notice.id);
  assert.equal(await card("departure"), undefined);
  await manage.shareLifecycle(clan, leader, removal.card_id, { skip: true });

  await ledger.savePolicy(clan, {
    values: { welcome_enabled: false, departures_enabled: false },
    by: elder,
  });
  await roster("member");
  await life.drain();
  assert.match(
    (await find(c, seat, "member_joined"))[0].clan_story.lines[0],
    /Welcome back/,
  );
  assert.equal(await card("welcome"), undefined);
});
