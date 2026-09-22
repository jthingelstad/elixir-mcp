/**
 * The Card of the Week issue as facts: the week it covers, the two
 * windows named in the coverage line, the names the repair pass may put
 * back, and that what the accept step produces actually renders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMail } from "@elixir-mcp/mail";
import {
  issueWeek,
  cardOfWeekFacts,
  briefNames,
} from "../src/email/card-of-week.mjs";
import { cardAsset } from "../src/email/build-card-of-week.mjs";

const brief = {
  kind: "card_of_week",
  period_key: "2026-W38",
  generated_at: "2026-09-25T05:10:00.000Z",
  card: {
    id: 28000015,
    name: "Barbarian Barrel",
    rarity: "epic",
    type: "spell",
    elixir_cost: 2,
    forms_available: ["hero"],
    icons: {
      base: cardAsset(28000015, "base", 160),
      hero: cardAsset(28000015, "hero", 96),
    },
    page_url: "https://elixir.poapkings.com/cards/28000015",
  },
  windows: {
    headline: {
      label: "Sep 14 – 21",
      from_day: 14,
      to_day: 21,
      month: "September",
      year: 2026,
    },
    depth: { season_month: "2026-09", label: "season 2026-09 to date" },
  },
  population: {
    recorded_players: 1060,
    recorded_clans: 18,
    players_in_window: 116126,
  },
  rank: {
    position: 1,
    of: 124,
    above: null,
    below: { name: "Minion Giant", usage_share_pct: 23.7 },
  },
  partners: [{ name: "Goblinstein", form: "base", lift: 2.02 }],
  decks: [
    {
      archetype_label: "Hog Rider cycle",
      average_elixir: 2.75,
      tower_troop: "Tower Princess",
      battles: 7683,
      players: 742,
      win_rate: 0.511,
      cards: [
        {
          id: 26000010,
          name: "Skeletons",
          form: "base",
          icon: "/assets/cards/26000010-64.png",
        },
        {
          id: 26000021,
          name: "Hog Rider",
          form: "base",
          icon: "/assets/cards/26000021-64.png",
        },
      ],
    },
  ],
  best_of_five: null,
  chart: {
    url: "/assets/mail/card_of_week/2026-W38/season.png",
    alt: "Usage by season.",
  },
};
const issue = {
  subject: "Card of the Week: Barbarian Barrel",
  preheader: "Two elixir, and the most-played card in the record.",
  body_markdown:
    "It appeared in 121,968 battles.\n\n{{deck:0}}\n\nGoblinstein predicts it.",
  numbers_used: [],
  subjects: ["a", "b"],
};

test("the issue covers the game week that closed on Monday", () => {
  // A Friday send covers the week that closed the Monday before it, the
  // same grid the other reports use.
  const { week, periodKey } = issueWeek(new Date("2026-09-25T14:00:00Z"));
  assert.equal(week.from.toISOString(), "2026-09-14T10:00:00.000Z");
  assert.equal(week.to.toISOString(), "2026-09-21T10:00:00.000Z");
  assert.equal(periodKey, "2026-W38");
});

test("the coverage line names BOTH windows and the record they came from", () => {
  const facts = cardOfWeekFacts(brief, issue);
  assert.match(
    facts.coverage,
    /game week of 14 to 21 September 2026 \(headline\)/,
  );
  assert.match(
    facts.coverage,
    /season 2026-09 to date \(modes, bands, partners, decks\)/,
  );
  assert.match(facts.coverage, /1060 recorded players across 18 clans/);
  assert.match(facts.coverage, /Only decided one-on-one battles count/);
});

test("the names the repair pass may restore are the brief's own", () => {
  const names = briefNames(brief);
  for (const n of [
    "Barbarian Barrel",
    "Goblinstein",
    "Skeletons",
    "Hog Rider",
    "Minion Giant",
  ])
    assert.ok(names.includes(n), `${n} is a brief name`);
});

test("what accept produces renders as mail", () => {
  const facts = cardOfWeekFacts(brief, issue);
  const { subject, html } = renderMail("card_of_week", facts, {
    unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
    manage: "https://elixir.poapkings.com/account/profile/email",
    period: "2026-W38",
  });
  assert.equal(subject, "Card of the Week: Barbarian Barrel");
  assert.ok(!/\{\{deck:/.test(html), "the deck placeholder was filled");
  assert.ok(html.includes('alt="Skeletons"'), "the deck's own cards");
  assert.ok(html.includes("28000015_hero-96.png"), "the hero form's art");
  assert.ok(
    html.includes("https://elixir.poapkings.com/cards/28000015"),
    "the issue links its card page",
  );
  assert.ok(!/undefined|NaN/.test(html));
});

test("card art is ours, by id and form, at the size the mail asks for", () => {
  assert.equal(
    cardAsset(28000015, "base", 160),
    "https://elixir.poapkings.com/assets/cards/28000015-160.png",
  );
  assert.equal(
    cardAsset(26000024, "evolution", 64),
    "https://elixir.poapkings.com/assets/cards/26000024_evo-64.png",
  );
  assert.equal(
    cardAsset(28000015, "hero", 96),
    "https://elixir.poapkings.com/assets/cards/28000015_hero-96.png",
  );
});
