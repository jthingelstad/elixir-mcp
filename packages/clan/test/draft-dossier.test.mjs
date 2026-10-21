/**
 * The draft's packet joins the member's dossier and Elixir's story
 * angles after the member block (Jamie, 2026-10-20): `storyFor` is asked
 * for the one member, and each kind is told what it may be. The model
 * is scripted; nothing reaches the network. Synthetic people only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { inventedNumbers } from "@elixir-mcp/clan-engine";
import { EXAMPLE_POLICY } from "@elixir-mcp/clan-engine/fixtures";
import { createDrafts } from "../src/manage/drafts.mjs";

const CLAN = "#TEST";
const DOT = "#SYNTHETIC";
const who = { player_tag: "#LEAD", role: "leader", verified: true };
const NOW = Date.parse("2026-10-20T12:00:00Z");

const week = (season_id, section_index, ago, decks_used, points) => ({
  season_id,
  section_index,
  is_colosseum: false,
  ago,
  decks_used,
  points,
});

/** Nothing in the last six weeks (the example policy's recent weeks);
 *  five weeks played before them. */
const DOSSIER = {
  days: 28,
  war: [
    week(136, 1, 0, 0, 0),
    week(136, 0, 1, 2, 300),
    week(135, 4, 2, 0, 0),
    week(135, 3, 3, 0, 0),
    week(135, 2, 4, 0, 0),
    week(135, 1, 5, 0, 0),
    week(135, 0, 6, 16, 2950),
    week(134, 3, 7, 16, 3150),
    week(134, 2, 8, 12, 2250),
    week(134, 1, 9, 16, 2800),
    week(134, 0, 10, 16, 2700),
  ],
  donations: {
    weeks: [
      { week: "2026-10-12", ago: 0, donations: 12 },
      { week: "2026-08-31", ago: 6, donations: 260 },
    ],
    career: 38170,
  },
  profile: {
    years_played: 5,
    favorite_card: "Valkyrie",
    masteries_at_top: 3,
    mastery_level: 10,
    masteries: ["Valkyrie", "Hog Rider", "Zap"],
    legendary_badges: ["Classic Challenge 12 Wins"],
    pol_best_league: 6,
    clan_war_wins: 87,
  },
  decks: [
    {
      mode: "ladder",
      games: 41,
      wins: 23,
      losses: 18,
      decks: [{ label: "Hog Rider cycle", games: 30, wins: 17, losses: 13 }],
    },
  ],
  moments: [
    {
      at: "2026-10-09T10:00:00Z",
      text: "Dot reached a new best: 9,450 trophies.",
    },
  ],
  roles: [{ at: "2026-07-01T06:00:00Z", before: "member", after: "elder" }],
  awards: [],
};

const STORY = (tags, { dossier = true } = {}) => ({
  clan: { name: "Example Clan", members: 40, war: [] },
  members: Object.fromEntries(
    tags.map((t) => [
      t,
      {
        name: "Dot",
        role: "elder",
        trophies: 9300,
        best_trophies: 9450,
        joined_at: "2026-04-02T00:00:00Z",
        tenure_days: 201,
        stints_before: 0,
        war: [],
        moments: [],
        awards: [],
      },
    ]),
  ),
  ...(dossier && tags.length === 1 ? { dossier: DOSSIER } : {}),
});

const CARDS = {
  promotion: {
    type: "promotion",
    evidence: {
      facts: [],
      message: { title: "New Elder", body: "{name} is now an Elder." },
    },
  },
  demotion: {
    type: "demotion",
    evidence: {
      facts: [],
      message: { title: "Back to Member", body: "{name} moves to Member." },
    },
  },
  welcome: {
    type: "welcome",
    evidence: { joined_at: "2026-10-19T09:00:00Z", welcome: {} },
  },
  removal: { type: "removal", evidence: { facts: [] } },
};

async function draft(kind, { dossier = true } = {}) {
  const ledger = createMemoryLedger();
  await ledger.savePolicy(CLAN, { values: EXAMPLE_POLICY, by: who.player_tag });
  await ledger.putCard(CLAN, {
    card_id: kind,
    number: 1,
    clan_tag: CLAN,
    player_tag: DOT,
    player_name: "Dot",
    status: "proposed",
    policy_version: 1,
    raised_at: new Date(NOW).toISOString(),
    ...CARDS[kind],
  });
  const asked = [];
  let request = null;
  const drafts = createDrafts({
    ledger,
    now: () => NOW,
    requireRemovalSafety: async () => ({ evidence_version: "fixture-proof" }),
    storyFor: async (clanTag, tags) => {
      asked.push(tags);
      return STORY(tags, { dossier });
    },
    model: {
      async write(_clan, _who, _token, r) {
        request = r;
        return {
          model: "fake",
          input:
            kind === "promotion" || kind === "demotion"
              ? { title: "Thanks", body: "Thank you, Dot." }
              : { line: "Thanks, Dot." },
        };
      },
    },
  });
  await drafts.leaderMessage(CLAN, who, "token", kind);
  return { asked, prompt: request.prompt, context: request.context };
}

/** The packet's dossier and angles blocks. */
const block = (prompt, header) => {
  const at = prompt.indexOf(header);
  if (at < 0) return null;
  const end = prompt.indexOf("\n\n", at);
  return prompt.slice(at, end < 0 ? undefined : end);
};

test("a promotion's packet tells the member, then their dossier, then Elixir's angles; every angle's number is in the record told", async () => {
  const { asked, prompt } = await draft("promotion");
  assert.deepEqual(asked, [[DOT]]);
  const member = prompt.indexOf("MEMBER: Dot");
  const dossier = prompt.indexOf("MEMBER DOSSIER");
  const angles = prompt.indexOf("STORY ANGLES");
  assert.ok(member >= 0 && dossier > member && angles > dossier, prompt);
  assert.match(
    prompt,
    /Their decks over the last 28 days, each mode on its own: Trophy Road: 41 games, 23 wins, 18 losses/,
  );
  assert.match(prompt, /Legendary badges they hold: Classic Challenge 12 Wins/);
  const told = block(prompt, "STORY ANGLES");
  const rest = prompt.replace(told, "");
  assert.deepEqual(inventedNumbers(told.replace(/^\d+\. /gm, ""), rest), []);
  assert.doesNotMatch(prompt, /SYNTHETIC|fame/);
});

test("a demotion's dossier and angles hold only what they gave before the policy's recent weeks", async () => {
  const { prompt } = await draft("demotion");
  const dossier = block(prompt, "MEMBER DOSSIER");
  const angles = block(prompt, "STORY ANGLES");
  assert.match(
    dossier,
    /season 135 week 1: 16 decks, 2,950 points; season 134 week 4: 16 decks, 3,150 points/,
  );
  assert.match(dossier, /2026-08-31: 260/);
  for (const text of [dossier, angles]) {
    assert.doesNotMatch(
      text,
      /season 136|300 points|2026-10-12|\b0 decks|\b12\b(?! decks)|days ago|days since|Mastery|Trophy Road|38,170|best: 9,450/,
    );
  }
  assert.match(
    angles,
    /^1\. 5 war weeks in a row in this clan, season 134 week 1 to season 135 week 1: 13,850 points together\.$/m,
  );
});

test("a removal is told only the war weeks they played; a welcome its member's game", async () => {
  const removal = (await draft("removal")).prompt;
  const dossier = block(removal, "MEMBER DOSSIER");
  assert.match(
    dossier,
    /Across those war weeks: 6 weeks played, 78 decks, 14,150 points/,
  );
  assert.doesNotMatch(
    removal,
    /Donations|Mastery|Trophy Road|milestones|role changes|Legendary/,
  );
  const welcome = (await draft("welcome")).prompt;
  assert.match(
    block(welcome, "STORY ANGLES"),
    /^1\. On Trophy Road over the last 28 days: Hog Rider cycle, 17 wins and 13 losses\.$/m,
  );
});

test("without a dossier the packet is the member block alone, as before", async () => {
  const { prompt } = await draft("promotion", { dossier: false });
  assert.match(prompt, /MEMBER: Dot/);
  assert.doesNotMatch(prompt, /MEMBER DOSSIER|STORY ANGLES/);
});
