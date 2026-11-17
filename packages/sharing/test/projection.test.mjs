import test from "node:test";
import assert from "node:assert/strict";
import { ATTESTED_FACT_TYPES } from "@elixir-mcp/contracts";
import { publicItem, shareableItem } from "../src/projection.mjs";

const ID = "tl_0123456789abcdef0123";
const TAG = "#0QU8VGV";
const AT = "2026-11-17T12:00:00.000Z";
const moment = (extra = {}) => ({
  id: ID,
  kind: "badge_earned",
  section: "player",
  visibility: "public",
  at: AT,
  text: "A badge was earned",
  subject_tag: TAG,
  subjects: [{ kind: "player", tag: TAG, name: "<script>Ada</script>" }],
  facts: {
    player_tag: TAG,
    name: "<script>Ada</script>",
    badge: "Wins",
    badge_label: "Wins",
    level: 5,
  },
  ...extra,
});

test("public projection preserves canonical facts and names without serializing the member response", () => {
  const input = moment({
    account_id: "private-account",
    nickname: "private-name",
    groups: ["friends"],
    offer_follow: true,
    evidence: { private: true },
    battle_url: "/battle/another-item",
    cheers: { mine: "well_played", count: 7 },
    comments: { latest: [{ text: "private-comment" }] },
    facts: {
      ...moment().facts,
      unregistered: "private-value",
      nickname: "private-name",
    },
  });
  const before = structuredClone(input);
  const out = publicItem(input);
  assert.deepEqual(out, {
    id: ID,
    kind: "badge_earned",
    section: "player",
    at: AT,
    text: "A badge was earned",
    subject_tag: TAG,
    subjects: [{ kind: "player", tag: TAG, name: "<script>Ada</script>" }],
    facts: moment().facts,
  });
  assert.deepEqual(
    input,
    before,
    "projection does not mutate its canonical input",
  );
  assert.ok(!JSON.stringify(out).includes("private-"));
});

test("unknown and inherited kind names fail closed, as do invalid item identities and nonpublic game facts", () => {
  for (const kind of [
    "new_future_kind",
    "toString",
    "constructor",
    "__proto__",
  ])
    assert.equal(publicItem(moment({ kind })), null, kind);
  for (const id of [null, "", "tl_123", ID.toUpperCase(), `${ID}?x=1`])
    assert.equal(shareableItem(moment({ id })), false, String(id));
  for (const visibility of [undefined, "clan", "leaders", "player"])
    assert.equal(publicItem(moment({ visibility })), null, String(visibility));
});

test("account and attested sections never become public through a special item branch", () => {
  for (const section of ["account", "attested"])
    for (const extra of [
      {},
      { kind: "post", post: { text: "private" } },
      { kind: "battle", battle: { id: "one" } },
    ])
      assert.equal(
        publicItem(moment({ section, ...extra })),
        null,
        `${section}/${extra.kind ?? "badge"}`,
      );
});

test("every attested fact kind stays private even without a trustworthy section label", () => {
  for (const kind of Object.keys(ATTESTED_FACT_TYPES))
    for (const section of [undefined, "attested", "clan", "player"])
      assert.equal(
        publicItem(moment({ kind, section })),
        null,
        `${kind}/${section}`,
      );
});

test("account kinds stay private independent of section, and legacy highlights require post authorization", () => {
  for (const kind of [
    "account",
    "account_feedback_responded",
    "account_new_future_kind",
    "battle_highlight",
  ])
    for (const section of [undefined, "player", "battles", "people"])
      assert.equal(
        publicItem(moment({ kind, section })),
        null,
        `${kind}/${section}`,
      );
});

test("Date values remain ISO instants at every projected depth", () => {
  const out = publicItem(
    moment({
      kind: "battle_session",
      at: new Date(AT),
      observed_at: new Date(AT),
      facts: {
        player_tag: TAG,
        name: "Ada",
        started_at: new Date(AT),
        ended_at: new Date(AT),
        by_mode: { ranked: { at: new Date(AT), won: 2 } },
      },
    }),
  );
  assert.equal(out.at, AT);
  assert.equal(out.observed_at, AT);
  assert.equal(out.facts.started_at, AT);
  assert.equal(out.facts.by_mode.ranked.at, AT);
});

test("a shared session keeps its public result strip and score facts", () => {
  const spark = [
    { r: "w", m: 3 },
    { r: "l", m: 1 },
  ];
  const scores = { best: { crowns: 3, against: 0 }, three: 1, overtime: 0 };
  const out = publicItem(moment({ kind: "battle_session", spark, scores }));
  assert.deepEqual(out.spark, spark);
  assert.deepEqual(out.scores, scores);
});

test("a public post keeps its writing, attachments and public author, without reader flags or browsing links", () => {
  const cards = [{ id: 26000000, name: "Knight", elixir_cost: 3 }];
  const post = {
    id: "42",
    text: "Three crowns",
    question: true,
    author: {
      account_id: "private-account",
      player_tag: TAG,
      name: "Ada",
      nickname: "private-name",
    },
    deck: {
      label: "A deck",
      cards,
      copy_link: "https://link.clashroyale.com/deck/en?deck=26000000",
    },
    cards,
    battle: {
      battle_id: "one",
      crowns: 3,
      crowns_against: 1,
      outcome: "win",
      url: "/battle/one",
    },
    versus: {
      mine: { label: "A deck", cards },
      theirs: { label: "Another deck", cards },
    },
    mine: true,
    can_edit: true,
    share_url: "private-link",
  };
  const input = moment({ kind: "post", post });
  const out = publicItem(input);
  assert.deepEqual(out.post.author, { player_tag: TAG, name: "Ada" });
  assert.deepEqual(
    out.post.versus,
    post.versus,
    "mine here is a public deck, not the reader's ownership flag",
  );
  assert.equal(out.post.text, "Three crowns");
  assert.deepEqual(out.post.deck, post.deck);
  assert.deepEqual(out.post.cards, cards);
  assert.equal(out.post.question, true);
  for (const key of ["id", "mine", "can_edit", "share_url"])
    assert.ok(!(key in out.post), key);
  assert.ok(!("url" in out.post.battle));
  assert.equal(input.post.battle.url, "/battle/one");
  assert.ok(!JSON.stringify(out).includes("private-"));
  for (const status of ["hidden", "removed", "deleted"])
    assert.equal(publicItem({ ...input, post: { ...post, status } }), null);
});

test("public battle data keeps exactly one battle, without history, images, account controls or a bare record link", () => {
  const battle = {
    id: "one",
    battle_time: new Date(AT),
    url: "/battle/one",
    image: "/battle/one.png",
    mode_group: "ranked",
  };
  const input = moment({
    kind: "battle",
    battle,
    sides: [
      { players: [{ player_tag: TAG, name: "Ada", nickname: "private-name" }] },
    ],
    games: [],
    score: { left: 3, right: 1, unit: "crowns" },
    meetings: [{ id: "another" }],
    around: [{ id: "more" }],
  });
  const out = publicItem(input);
  assert.equal(out.battle.id, "one");
  assert.equal(out.battle.battle_time, AT);
  assert.deepEqual(out.score, { left: 3, right: 1, unit: "crowns" });
  assert.deepEqual(out.sides, [
    { players: [{ player_tag: TAG, name: "Ada" }] },
  ]);
  for (const key of ["meetings", "around"]) assert.ok(!(key in out));
  for (const key of ["url", "image"]) assert.ok(!(key in out.battle));
  assert.equal(input.battle.url, "/battle/one");
});

test("earned public Stamps contain no exact progress, place, account pointer or private alias", () => {
  const out = publicItem(
    moment({
      kind: "stamp_earned",
      section: "people",
      facts: {
        account_id: "private-account",
        account_name: "private-alias",
        latitude: 1,
        longitude: 2,
        stamps: [
          {
            id: "on_the_map",
            name: "On the Map",
            level: 1,
            icon: "map",
            progress: 7,
            location: "private-place",
          },
        ],
      },
    }),
  );
  assert.deepEqual(out.facts, {
    stamps: [{ id: "on_the_map", name: "On the Map", level: 1, icon: "map" }],
  });
  assert.ok(!JSON.stringify(out).includes("private-"));
  assert.equal(
    publicItem(moment({ kind: "future_people_kind", section: "people" })),
    null,
  );
});
