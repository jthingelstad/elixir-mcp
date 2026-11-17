/** The one link a clan's activity post carries back to Elixir: the most
 *  specific page, in angle brackets, never previewed. Invented tags. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkLine,
  storyBattleIds,
  storyLink,
  withLink,
} from "../src/story-link.mjs";

const CLAN = "#J2RGCRVG";
const ORIGIN = "https://elixir.poapkings.com";
const BATTLE = "a".repeat(64);
const battles = new Map([[BATTLE, { url: `${ORIGIN}/battle/aaaaaaaaaaaa` }]]);
const item = (kind, facts = {}) => ({
  id: `tl_${kind}`,
  kind,
  facts: { player_tag: "#0GLCPGJJ", ...facts },
});

test("each story links to its most specific page", () => {
  const promo = item("ranked_promotion", {
    promoted_by: { battle_id: BATTLE },
  });
  assert.deepEqual(storyBattleIds([{ items: [promo] }]), [BATTLE]);
  assert.equal(
    storyLink([promo], { clanTag: CLAN, battles }),
    `${ORIGIN}/battle/aaaaaaaaaaaa`,
  );
  // A battle the record does not hold: the member's player page.
  assert.equal(
    storyLink([promo], { clanTag: CLAN }),
    `${ORIGIN}/home/player/0GLCPGJJ`,
  );
  const sitting = item("session_standout", {
    best_win: { battle_id: BATTLE },
  });
  assert.equal(
    storyLink([sitting], { clanTag: CLAN, battles }),
    `${ORIGIN}/battle/aaaaaaaaaaaa`,
  );
  assert.equal(
    storyLink([item("member_left")], { clanTag: CLAN, battles }),
    `${ORIGIN}/clan/J2RGCRVG/feed`,
  );
  assert.equal(
    storyLink([item("race_finished", { player_tag: undefined })], {
      clanTag: CLAN,
    }),
    `${ORIGIN}/clan/J2RGCRVG/war`,
  );
  assert.equal(
    storyLink([item("award_granted")], { clanTag: CLAN }),
    `${ORIGIN}/clan/J2RGCRVG/standings`,
  );
  // Several members: the clan's Feed.
  assert.equal(
    storyLink(
      [item("badge_earned"), item("badge_earned", { player_tag: "#0L98VL0Y" })],
      { clanTag: CLAN },
    ),
    `${ORIGIN}/clan/J2RGCRVG/feed`,
  );
});

test("a sitting links its session page, before its best win (2026-11-16)", () => {
  const sitting = (id, at, facts = {}) => ({
    id,
    kind: "session_standout",
    evidence: { kind: "session" },
    facts: {
      player_tag: "#0GLCPGJJ",
      started_at: at,
      best_win: { battle_id: BATTLE },
      ...facts,
    },
  });
  const one = sitting("tl_s1", "2026-11-16T15:00:00.000Z");
  assert.equal(
    storyLink([one], { clanTag: CLAN, battles }),
    `${ORIGIN}/home/player/0GLCPGJJ/session/tl_s1?at=2026-11-16T15%3A00%3A00.000Z`,
  );
  // A moment told with its sitting still opens the sitting.
  const promo = item("ranked_promotion", {
    promoted_by: { battle_id: BATTLE },
  });
  assert.match(
    storyLink([one, promo], { clanTag: CLAN, battles }),
    /\/session\/tl_s1\?at=/,
  );
  // Two sittings have no one page: the battle, as before.
  assert.equal(
    storyLink([one, sitting("tl_s2", "2026-11-16T19:00:00.000Z")], {
      clanTag: CLAN,
      battles,
    }),
    `${ORIGIN}/battle/aaaaaaaaaaaa`,
  );
});

test("the link is masked around an angle-bracketed address and survives a long post", () => {
  const url = `${ORIGIN}/clan/J2RGCRVG/feed`;
  assert.equal(linkLine(url), `[Open in Elixir](<${url}>)`);
  const long = withLink("x".repeat(2500), url);
  assert.equal(long.length, 2000);
  assert.ok(long.endsWith(`\n[Open in Elixir](<${url}>)`));
  assert.equal(withLink("hi", null), "hi");
});
