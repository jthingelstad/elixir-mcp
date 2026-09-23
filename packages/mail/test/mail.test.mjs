import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderMail,
  htmlToText,
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribeUrl,
  lintIssue,
  KIND_LABELS,
} from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://elixir.poapkings.com";
const fixtures = path.join(here, "../fixtures");
const links = {
  unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
  manage: "https://elixir.poapkings.com/account/profile/email",
  period: "2026-W37",
};

test("every kind renders its fixture: subject, preheader, html, and a text alternative", () => {
  for (const file of readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
    const kind = file.replace(".json", "");
    const facts = JSON.parse(readFileSync(path.join(fixtures, file), "utf8"));
    const out = renderMail(kind, facts, links);
    assert.ok(
      out.subject.length > 4 && out.subject.length < 120,
      `${kind} subject: ${out.subject}`,
    );
    assert.ok(
      out.html.includes(links.unsubscribe),
      `${kind} carries the one-click link`,
    );
    assert.ok(
      out.html.includes("not endorsed by Supercell"),
      `${kind} carries the disclaimer`,
    );
    assert.ok(
      !/undefined|NaN|\[object Object\]/.test(out.html),
      `${kind} html has no leaks`,
    );
    // Exactly ONE image may be a tracking image, and it is the
    // Tinylytics pixel naming the mail rather than the reader. Card of
    // the Week carries content images too, so the rule is stated as
    // what it has always meant: every other image is served by us, and
    // says what it is to a reader who cannot see it.
    const tags = out.html.match(/<img\b[^>]*>/gi) ?? [];
    const pixels = tags.filter((t) => /tinylytics\.app/.test(t));
    assert.equal(pixels.length, 1, `${kind} carries exactly the pixel`);
    for (const tag of tags.filter((t) => !/tinylytics\.app/.test(t))) {
      const src = /src="([^"]*)"/.exec(tag)?.[1] ?? "";
      assert.ok(
        src.startsWith("/assets/") || src.startsWith(`${SITE}/assets/`),
        `${kind} image is served by us, not hotlinked: ${src}`,
      );
      assert.ok(
        /alt="[^"]+"/.test(tag),
        `${kind} content image has alt text: ${tag.slice(0, 80)}`,
      );
    }
    assert.ok(
      out.html.includes(
        `pixel/Yzx8dUUvUPn9AEJpTMeU.gif?path=${encodeURIComponent(`/mail/${kind}/2026-W37`)}`,
      ),
      `${kind} pixel path`,
    );
    const text = htmlToText(out.html);
    assert.ok(text.length > 200, `${kind} text alternative`);
    assert.ok(!/<[a-z]/i.test(text), `${kind} text has no tags`);
    assert.ok(KIND_LABELS[kind], `${kind} has a label`);
  }
});

test("names are links into Browse carrying the campaign tag, tags only in the title", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "arena_week.json"), "utf8"),
  );
  const { html } = renderMail("arena_week", facts, links);
  assert.ok(
    html.includes(
      'href="https://elixir.poapkings.com/explore/player/20JJJ2CCRU?utm_source=email&utm_medium=arena_week&utm_campaign=arena_week-2026-W37"',
    ),
    html.match(/explore\/player\/20JJJ2CCRU[^"]*/)?.[0],
  );
  assert.ok(html.includes('title="#20JJJ2CCRU"'));
  // The manage link is tagged; the one-click unsubscribe is not (an API
  // path with no embed, and the ledger records it anyway).
  assert.ok(html.includes("account/profile/email?utm_source=email"));
  assert.ok(
    html.includes(
      'href="https://elixir.poapkings.com/api/email/unsubscribe?t=x"',
    ),
  );
});

test("links.pixel false renders tagged links without the open pixel (the public page)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "top_100.json"), "utf8"),
  );
  const { html } = renderMail("top_100", facts, { ...links, pixel: false });
  assert.ok(!/<img/i.test(html));
  assert.ok(html.includes("utm_campaign=top_100-2026-W37"));
});

test("links.send_id puts the send's id and its console link in the footer; a page render has neither", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "milestone.json"), "utf8"),
  );
  const id = "3f2a9c1b-0000-4000-8000-000000000001";
  const { html } = renderMail("milestone", facts, { ...links, send_id: id });
  assert.ok(html.includes(`This email is <a`));
  // The record, the feedback link and the list are tagged like every
  // other link into the site: a send id is a product identifier, and
  // the click is counted per campaign (ENGINEERING, "Product
  // identifiers versus measurement").
  assert.ok(
    html.includes(
      `href="https://elixir.poapkings.com/account/activity/e/${id}?utm_source=email`,
    ),
  );
  assert.ok(
    html.includes(
      `href="https://elixir.poapkings.com/account/activity/e/${id}?report=1&amp;utm_source=email`,
    ) ||
      html.includes(
        `href="https://elixir.poapkings.com/account/activity/e/${id}?report=1&utm_source=email`,
      ),
  );
  assert.ok(
    html.includes(
      "https://elixir.poapkings.com/account/activity/emails?utm_source=email",
    ),
  );
  // Every product email carries the same support line, tagged by kind.
  assert.ok(
    html.includes(
      "https://elixir.poapkings.com/support?utm_source=email&utm_medium=milestone",
    ),
  );
  assert.ok(html.includes("Support Elixir"));
  const text = htmlToText(html);
  assert.ok(text.includes(id), "the text alternative carries the id too");
  const page = renderMail("milestone", facts, links).html;
  assert.ok(!page.includes("This email is <a"));
});

test("tagLink leaves foreign URLs alone and keeps an existing query string", async () => {
  const { tagLink } = await import("../src/index.mjs");
  assert.equal(
    tagLink("https://example.org/x", {
      kind: "milestone",
      period: "2026-09-19",
    }),
    "https://example.org/x",
  );
  assert.equal(
    tagLink("https://elixir.poapkings.com/api/public/top100/2026-09-18?v=1", {
      kind: "top_100",
      period: "2026-09-18",
    }),
    "https://elixir.poapkings.com/api/public/top100/2026-09-18?v=1&utm_source=email&utm_medium=top_100&utm_campaign=top_100-2026-09-18",
  );
});

test("a clan report subject says the war place and the churn", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const { subject } = renderMail("clan_report", facts, links);
  assert.equal(subject, "POAP KINGS, Sep 7 – 14: 1st in war, 3 left, 3 joined");
});

test("renderMail refuses a kind it does not know and a send without links", () => {
  assert.throws(() => renderMail("newsletter", {}, links), /unknown kind/);
  assert.throws(() => renderMail("milestone", {}, {}), /links/);
});

test("the unsubscribe token round-trips, binds account and kind, and refuses tampering", () => {
  const secret = "s3cret";
  const token = signUnsubscribe({
    secret,
    accountId: "8b6a2b6e-0c3c-4b3a-9a0e-2f1f8f2d9c11",
    kind: "clan_report",
    issuedAt: 1_758_000_000_000,
  });
  const c = verifyUnsubscribe({ secret, token });
  assert.deepEqual(c, {
    accountId: "8b6a2b6e-0c3c-4b3a-9a0e-2f1f8f2d9c11",
    kind: "clan_report",
    issuedAt: 1_758_000_000_000,
  });
  assert.equal(verifyUnsubscribe({ secret: "other", token }), null);
  assert.equal(
    verifyUnsubscribe({ secret, token: token.slice(0, -2) + "zz" }),
    null,
  );
  assert.equal(verifyUnsubscribe({ secret, token: "garbage" }), null);
  assert.ok(
    unsubscribeUrl(token).startsWith(
      "https://elixir.poapkings.com/api/email/unsubscribe?t=",
    ),
  );
});

test("htmlToText keeps table rows on one line and prints hrefs once", () => {
  const text = htmlToText(
    '<table><tr><td>Player</td><td>+702</td></tr></table><p>See <a href="https://x.example/a">the page</a> and <a href="https://x.example/b">https://x.example/b</a>.</p>',
  );
  assert.match(text, /Player +\+702/);
  assert.ok(text.includes("the page (https://x.example/a)"));
  assert.ok(!text.includes("https://x.example/b (https://x.example/b)"));
});

test("the Top 100 lint traces numbers to the brief and rejects tags, bangs and unpaired rows", () => {
  const brief = {
    board: { cutoff_rating: 2434, inflation: 450 },
    movers: {
      up: [{ name: "A", rank_from: 166, rank_to: 8, rating_delta: 702 }],
    },
    season: { id: 136 },
  };
  const ok = {
    subject: "s",
    body_markdown:
      "## The board\n\nThe floor is 2434. Up 450 in a week.\n\n| Player | Rank | Rating |\n|---|---|---|\n| A | 166 → 8 | +702 |",
    numbers_used: [{ claim: "floor", brief_path: "board.cutoff_rating" }],
  };
  assert.deepEqual(lintIssue(ok, brief), []);
  const bad = {
    subject: "s",
    body_markdown:
      "Wow! A (#C89L0002L) climbed 9999 places.\n\n| A | 166 → 8 | |",
    numbers_used: [{ claim: "x", brief_path: "board.nope" }],
  };
  const problems = lintIssue(bad, brief);
  assert.ok(problems.some((p) => /exclamation/.test(p)));
  assert.ok(problems.some((p) => /bare tag/.test(p)));
  assert.ok(problems.some((p) => /9999/.test(p)));
  assert.ok(problems.some((p) => /without a rating delta/.test(p)));
  assert.ok(problems.some((p) => /does not resolve/.test(p)));
});

test("a rate in the brief traces through every spelling a writer uses", () => {
  // The bug this pins: the meta section's usage_share and win_rate are
  // rates, canonicalised as integers (0.343 -> "1"), so every percentage
  // the writer printed from them was reported unsourced and the editor
  // pass deleted a true number. It failed quiet, because the second lint
  // then passed over the stripped body.
  const brief = {
    meta: {
      cards: [{ name: "Barbarian Barrel", usage_share: 0.343, players: 84 }],
      decks: [{ battles: 7683, win_rate: 0.512, players: 742 }],
    },
    season: { id: 136 },
  };
  const ok = {
    subject: "s",
    body_markdown:
      "It is in 34.3 percent of their battles, and that deck wins 51.2 percent over 7,683 battles with 742 players.",
    numbers_used: [],
  };
  // The body is deliberately short, so only the number findings matter.
  assert.deepEqual(
    lintIssue(ok, brief, { kind: "card_of_week" }).filter((p) =>
      /not in the brief/.test(p),
    ),
    [],
  );
  // A decimal is judged whole: a wrong one no longer passes on a right
  // integer part.
  const altered = {
    subject: "s",
    body_markdown: "It is in 34.9 percent of their battles.",
    numbers_used: [],
  };
  assert.ok(
    lintIssue(altered, brief, { kind: "card_of_week" }).some((p) =>
      /34\.9 is not in the brief/.test(p),
    ),
  );
});

test("the length rules are the kind's, and a gutted issue is refused", () => {
  const brief = { season: { id: 136 } };
  const short = {
    subject: "s",
    body_markdown: "One short line.",
    numbers_used: [],
  };
  // The Top 100 has no floor; Card of the Week does, because an editor
  // pass that cuts an issue to nothing passes every other rule.
  assert.deepEqual(lintIssue(short, brief), []);
  assert.ok(
    lintIssue(short, brief, { kind: "card_of_week" }).some((p) =>
      /the floor is 380/.test(p),
    ),
  );
  // The rank-and-rating pairing is the Top 100's rule alone.
  const deckRow = {
    subject: "s",
    body_markdown: "| Skeletons → Hog Rider | 51 |",
    numbers_used: [],
  };
  assert.ok(
    lintIssue(deckRow, brief).some((p) => /without a rating delta/.test(p)),
  );
  assert.ok(
    !lintIssue(deckRow, brief, { kind: "card_of_week" }).some((p) =>
      /without a rating delta/.test(p),
    ),
  );
});

test("a deck block is the record's own cards, in order, four to a row", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "card_of_week.json"), "utf8"),
  );
  const { html } = renderMail("card_of_week", facts, links);
  // The writer PLACES a deck ({{deck:N}}) and never spells it: the cards
  // come from the brief, so a deck block cannot disagree with the record.
  assert.ok(!/\{\{deck:/.test(html), "the placeholder was replaced");
  const deck = facts.decks[1];
  const alts = [...html.matchAll(/<img\b[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
  for (const card of deck.cards) {
    const label =
      (card.form === "hero"
        ? "Hero "
        : card.form === "evolution"
          ? "Evo "
          : "") + card.name;
    assert.ok(alts.includes(label), `${label} is in the block`);
  }
  // A form carries its OWN art, never the base card's. A 64px deck cell
  // loads the 128px file: displayed at 64, so it is sharp on retina.
  assert.ok(html.includes("28000015_hero-128.png"), "the hero form's icon");
  assert.ok(html.includes("26000024_evo-128.png"), "the evolution's icon");
  assert.ok(/width="64" height="94"/.test(html), "displayed at 64, not 128");
  // An image src carries NO campaign tag. It is not a link anyone
  // follows, so the tag measures nothing - and a per-campaign URL would
  // give every week its own copy of the same art in the reader's cache.
  const imgSrcs = [...html.matchAll(/<img\b[^>]*src="([^"]*)"/g)].map(
    (m) => m[1],
  );
  for (const src of imgSrcs.filter((s) => s.includes("/assets/")))
    assert.ok(!src.includes("utm_"), `image src is untagged: ${src}`);
  assert.ok(
    imgSrcs.some((s) => s.includes("/assets/")),
    "there are images",
  );
  // Table layout only: Outlook's engine is Word's.
  assert.ok(!/display:\s*(flex|grid)/.test(html), "no flex or grid");
  assert.ok(!/background-image/.test(html), "no background images");
  // Text: one line per row of four, then the caption.
  const text = htmlToText(html);
  assert.ok(
    text.includes("Fisherman Electro Spirit Fireball Hero Barbarian Barrel"),
    text.split("\n").filter((l) => /Fisherman/.test(l))[0],
  );
  assert.ok(text.includes("3,999 battles · 447 players · 52.0% win rate"));
  // Four decks, not three (Jamie, 2026-09-22).
  assert.equal(facts.decks.length, 4);
  assert.ok(html.includes('alt="Rune Giant"'), "the fourth deck is placed");
  // No trend, no chart. Elixir's corpus grew two orders of magnitude over
  // the months it has been recording, so a season series would draw our
  // own coverage and call it the card's popularity. The brief withholds
  // it until enough seasons are comparable, and the mail draws nothing.
  assert.equal(facts.chart, null);
  assert.ok(!/usage share by season/.test(html));
});

test("a chart, when the record has earned one, carries its series in alt text", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "card_of_week.json"), "utf8"),
  );
  facts.chart = {
    url: "/assets/mail/card_of_week/2026-W38/season.png",
    alt: "Barbarian Barrel usage share by season: 2026-08 21.7 percent, 2026-09 31.2 percent.",
  };
  const { html } = renderMail("card_of_week", facts, links);
  assert.ok(/alt="Barbarian Barrel usage share by season[^"]+"/.test(html));
  assert.ok(html.includes('width="560"'));
});

test("repairNames puts a name the model's JSON mangled back from the brief", async () => {
  const { repairNames } = await import("../src/index.mjs");
  const body =
    'A week ago **Hypno "u2764\ns Hans** held rank 1; TR⚡️Matthew⚡️ climbed.';
  const out = repairNames(body, ["Hypno ❤️ Hans", "TR⚡️Matthew⚡️", "JTR_CR"]);
  assert.ok(out.includes("**Hypno ❤️ Hans**"), out);
  assert.ok(out.includes("TR⚡️Matthew⚡️ climbed"));
});
