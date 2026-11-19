import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG as peer,
  READER_TAG as me,
  STRANGER_TAG as other,
} from "../../../packages/posts/test/fixture.mjs";
import { sharedEvents } from "../src/shared-play.mjs";
import { clanPlay, compareClanPlay } from "../src/clan-play.mjs";
import { clanMemories } from "../src/clan-memories.mjs";
import { deckTrial } from "../src/deck-trials.mjs";
import { playerPlay } from "../src/player-play.mjs";

test("a shared event requires the same run and two currently visible friends with sessions", () => {
  const friends = [peer, me, other].map((tag) => ({
    kind: "player",
    tag,
    relationship: "friend",
  }));
  const connections = new Map([
    [peer, { connection: "friend" }],
    [me, { connection: "friend" }],
    [other, { connection: "clanmate" }],
  ]);
  const session = (player_tag, event_tag, id) => ({
    id,
    kind: "battle_session",
    evidence: { kind: "session" },
    facts: {
      player_tag,
      started_at: "2026-11-18",
      events: [{ name: "Quick Wit", event_tag, battles: 1 }],
    },
  });
  const rows = [
    session(peer, "one", "a"),
    session(peer, "one", "b"),
    session(other, "one", "c"),
    session(me, "two", "d"),
  ];
  assert.deepEqual(sharedEvents(rows, connections, friends), []);
  const [event] = sharedEvents(
    [...rows, session(me, "one", "e")],
    connections,
    friends,
  );
  assert.deepEqual(
    event.players.map((p) => p.session_id),
    ["a", "e"],
  );
});

test("nearby decks show the actual swaps and never cross modes or rely on one appearance", () => {
  const row = (tag, cards, own) => ({
    player_tag: tag,
    name: tag,
    own,
    clan_tag: "clan",
    type: "PvP",
    deck_hash: String(cards),
    plays: 2,
    card_ids: cards,
    card_names: cards.map(String),
  });
  const a = row(me, [1, 2, 3, 4, 5, 6, 7, 8], true);
  const b = row(peer, [8, 7, 6, 5, 4, 3, 2, 9], false);
  const match = compareClanPlay([a, b]).get(peer);
  assert.equal(match.shared, 7);
  assert.deepEqual(match.own_cards, ["1"]);
  assert.deepEqual(match.peer_cards, ["9"]);
  assert.equal(compareClanPlay([a, { ...b, type: "pathOfLegend" }]).size, 0);
  assert.equal(compareClanPlay([a, { ...b, plays: 1 }]).size, 0);
});

let ctx, people, post;
const clan = "#0PYLQ2";
const ids = Array.from({ length: 8 }, (_, i) => 26000000 + i);
const now = new Date(),
  ago = (d) => new Date(now.getTime() - d * 86400000);
before(async () => {
  ctx = await scratchDb("social_play");
  const db = ctx.db;
  people = await postFixture(db, "social-play");
  await db.query("insert into clan(clan_tag,name) values($1,'Invented clan')", [
    clan,
  ]);
  await db.query(
    "insert into clan_membership(player_tag,clan_tag,joined_observed_at,baseline) select tag,$1,$2,false from unnest($3::text[]) tag",
    [clan, ago(12), [peer, me]],
  );
  await db.query(
    "insert into card(card_id,name,kind) select id,case when id=$2 then 'Guards' else 'Card '||id end,'card' from unnest($1::int[]) id on conflict(card_id) do update set name=excluded.name",
    [ids, ids[0]],
  );
  await db.query(
    "insert into deck(deck_hash,card_count,first_seen_at,last_seen_at,card_ids,card_forms) values('shared-deck',8,$1,$2,$3,array_fill(0::smallint,array[8]))",
    [ago(14), now, ids],
  );
  for (let i = 0; i < 4; i++) {
    const id = String(i + 1).repeat(64),
      at = ago(3 - i / 2),
      type = i === 3 ? "tournament" : "PvP";
    await db.query(
      "insert into battle(battle_id,battle_time,type,type_class,deck_selection,tournament_tag) values($1,$2,$3,'pvp','collection',$4)",
      [id, at, type, i === 3 ? "#0Q2L8" : null],
    );
    for (const [side, tag] of [peer, me].entries())
      await db.query(
        "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,clan_tag,cards,deck_hash) values($1,$2,$3,$4,$5,'pvp',$6,$7,'shared-deck')",
        [id, tag, side, at, type, clan, ids],
      );
  }
  post = await people.post({
    at: ago(4),
    question: false,
    deck: { cards: ids },
  });
  await db.query(
    "insert into player_card(player_tag,card_id,level,first_seen_at,observed_at) select $1,id,16,$2,$3 from unnest($4::int[]) id",
    [me, ago(4), now, ids],
  );
  await db.query(
    "insert into player_event(player_tag,event_type,timing,window_start,window_end,card_id,badge_name,step) values($1,'card_maxed','estimated',$2,$3,$4,null,null),($1,'badge_earned','estimated',$2,$3,null,'MasterySkeletonWarriors',3)",
    [me, ago(3), ago(2), ids[0]],
  );
  await db.query(
    "insert into mode_season(progress_key,mode,first_seen_at,last_seen_at) values('AutoChess_2026_Season_11','AutoChess',$1,$2) on conflict do nothing",
    [ago(4), now],
  );
  await db.query(
    "insert into player_progress_daily(player_tag,progress_key,day,observed_at,best_trophies) values($1,'AutoChess_2026_Season_11',$2::timestamptz::date,$2,120),($1,'AutoChess_2026_Season_11',$3::timestamptz::date,$3,150)",
    [me, ago(3), ago(1)],
  );
});
after(async () => ctx?.drop());

test("clanmates' own decks, recent card use and a shared tournament come from different qualifying battles", async () => {
  const matches = await clanPlay(ctx.db, people.reader);
  assert.equal(matches.get(peer).exact, true);
  assert.equal(matches.get(peer).card.mine, 3);
  assert.deepEqual(await clanPlay(ctx.db, people.stranger), new Map());
  await ctx.db.query(
    `insert into war_week(clan_tag,season_id,section_index,started_observed_at,closed_at)
    values ($1,1,0,$2,$3),($1,1,1,$3,$4)`,
    [clan, ago(15), ago(8), ago(1)],
  );
  await ctx.db.query(
    `insert into war_week_clan(clan_tag,season_id,section_index,participant_clan_tag,participant_name,rank)
    values ($1,1,0,$1,'Home',3),($1,1,0,$2,'Invented rival',1),($1,1,1,$1,'Home',1),($1,1,1,$2,'Invented rival',3)`,
    [clan, "#0GRJCUV"],
  );
  await ctx.db.query(
    "insert into war_participation(clan_tag,season_id,section_index,player_tag,decks_used) values($1,1,1,$2,4)",
    [clan, me],
  );
  await ctx.db.query(
    "insert into clan_snapshot_daily(clan_tag,day,observed_at,snapshot_kind,donations_per_week) values($1,$2::timestamptz::date,$2,'pre_reset',1200)",
    [clan, ago(1)],
  );
  const lines = await clanMemories(ctx.db, people.reader, clan, now);
  assert.ok(lines.some((s) => s.includes("tournament #0Q2L8")));
  assert.ok(
    lines.some((s) => s.includes("Invented rival") && s.includes("#1 and #3")),
  );
  assert.ok(lines.some((s) => s.includes("1,200 donations")));
  assert.ok(
    lines.some(
      (s) => s.includes("First recorded war week") && s.includes("Reader"),
    ),
  );
});
test("the owner's matching later battle opens from a visible deck post", async () => {
  const proof = await deckTrial(ctx.db, people.reader, post.id, true);
  assert.equal(proof.match.player_tag, me);
  assert.ok(proof.match.source.name.includes("Writer"));
  const first = await deckTrial(
    ctx.db,
    people.reader,
    post.id,
    true,
    "1".repeat(64),
  );
  assert.equal(first.match.battle_id, "1".repeat(64));
  assert.deepEqual(
    await deckTrial(ctx.db, people.reader, post.id, true, "f".repeat(64)),
    { match: null },
  );
  assert.ok(proof.match.url.includes("/battle/"));
  assert.equal(await deckTrial(ctx.db, people.author, post.id, true), null);
  assert.equal(await deckTrial(ctx.db, people.stranger, post.id, true), null);
  const newer = await people.post({
    at: now,
    question: false,
    deck: { cards: ids },
  });
  assert.deepEqual(await deckTrial(ctx.db, people.reader, newer.id, true), {
    match: null,
  });
});
test("a Mastery milestone requires a played card and the maxed deck requires eight owned levels", async () => {
  const stories = await playerPlay(ctx.db, me, now);
  assert.ok(
    stories.some(
      (s) =>
        s.text.includes("Guards reached Mastery level 3") &&
        s.text.includes("3 recent"),
    ),
  );
  assert.ok(stories.some((s) => s.text.includes("eight cards")));
  assert.ok(stories.some((s) => s.text.includes("120 to 150")));
  await ctx.db.query(
    "update player_card set level=15 where player_tag=$1 and card_id=$2",
    [me, ids[1]],
  );
  assert.ok(
    !(await playerPlay(ctx.db, me, now)).some((s) =>
      s.text.includes("eight cards"),
    ),
  );
});
