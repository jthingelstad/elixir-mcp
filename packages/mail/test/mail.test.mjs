import { isRetiredEmailKind } from "@elixir-mcp/contracts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderMail,
  htmlToText,
  signUnsubscribe,
  UNSUBSCRIBE_KEY_ID,
  verifyUnsubscribe,
  unsubscribeUrl,
  KIND_LABELS,
  MAIL_SCHEDULE,
  cardAsset,
  resolveCardArt,
} from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://elixir.poapkings.com";
const LOGO = `${SITE}/assets/mail/elixir-96.png`;
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const fixtures = path.join(here, "../fixtures");
// Every fixture, the previewed ones and the variants kept with the tests
// (an issue stored before a redesign, a second shape of one kind), each
// named <kind>[-<what>].json.
const allFixtures = () =>
  [fixtures, path.join(here, "fixtures")].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f.replace(".json", ""),
        kind: f.replace(".json", "").split("-")[0],
        facts: JSON.parse(readFileSync(path.join(dir, f), "utf8")),
      })),
  );
const stored = (name) =>
  JSON.parse(readFileSync(path.join(here, "fixtures", `${name}.json`), "utf8"));
const links = {
  unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
  manage: "https://elixir.poapkings.com/console/account/profile/email",
  period: "2026-W37",
};

test("every kind renders its fixture: subject, preheader, html, and a text alternative", () => {
  for (const { kind, facts } of allFixtures()) {
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
    // Tinylytics pixel naming the mail rather than the reader. Every other
    // image is served by us and says what it is to a reader who cannot see it.
    const tags = out.html.match(/<img\b[^>]*>/gi) ?? [];
    const pixels = tags.filter((t) => /tinylytics\.app/.test(t));
    assert.equal(pixels.length, 1, `${kind} carries exactly the pixel`);
    for (const tag of tags.filter((t) => !/tinylytics\.app/.test(t))) {
      const src = /src="([^"]*)"/.exec(tag)?.[1] ?? "";
      assert.ok(
        src.startsWith(`${SITE}/assets/`),
        `${kind} image is an https PNG of ours, not hotlinked or inlined: ${src}`,
      );
      assert.ok(src.endsWith(".png"), `${kind} image is a PNG: ${src}`);
      // The logo stands beside the word "Elixir", so it is decorative
      // and says nothing; every other image says what it is.
      if (src === LOGO) assert.ok(/alt=""/.test(tag), `${kind} logo alt`);
      else
        assert.ok(
          /alt="[^"]+"/.test(tag),
          `${kind} content image has alt text: ${tag.slice(0, 80)}`,
        );
    }
    assert.ok(out.html.includes(`src="${LOGO}"`), `${kind} wears the logo`);
    // The inbox preview is the string the renderer returns, once.
    assert.equal(
      /<span style="display:none[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(
        out.html,
      )?.[1],
      esc(out.preheader),
      `${kind} preheader in the html is the one returned`,
    );
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
      'href="https://elixir.poapkings.com/console/explore/player/20JJJ2CCRU?utm_source=email&utm_medium=arena_week&utm_campaign=arena_week-2026-W37"',
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
    readFileSync(path.join(fixtures, "milestone.json"), "utf8"),
  );
  const { html } = renderMail("milestone", facts, { ...links, pixel: false });
  assert.ok(!/tinylytics/i.test(html));
  assert.ok(html.includes(LOGO), "the page still wears the logo");
  assert.ok(html.includes("utm_campaign=milestone-2026-W37"));
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
      `href="https://elixir.poapkings.com/console/account/activity/e/${id}?utm_source=email`,
    ),
  );
  assert.ok(
    html.includes(
      `href="https://elixir.poapkings.com/console/account/activity/e/${id}?report=1&amp;utm_source=email`,
    ) ||
      html.includes(
        `href="https://elixir.poapkings.com/console/account/activity/e/${id}?report=1&utm_source=email`,
      ),
  );
  assert.ok(
    html.includes(
      "https://elixir.poapkings.com/console/account/activity/emails?utm_source=email",
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

test("tagLink tags a link into every product the family's bar names", async () => {
  // The origins come from the kit's product manifest, the list the top
  // bar draws, so a product added there is tagged here with no edit.
  const { tagLink } = await import("../src/index.mjs");
  const { default: family } = await import("@elixir-mcp/ui/family.json", {
    with: { type: "json" },
  });
  const campaign = { kind: "milestone", period: "2026-09-19" };
  assert.ok(family.products.length > 0);
  for (const p of family.products) {
    const url = new URL(p.href ?? p.path, family.origin).href;
    assert.match(tagLink(url, campaign), /[?&]utm_source=email&/, p.key);
  }
  // Drop is on a host of its own, and its links are still ours.
  assert.equal(
    tagLink("https://drop.poapkings.com/play", campaign),
    "https://drop.poapkings.com/play?utm_source=email&utm_medium=milestone&utm_campaign=milestone-2026-09-19",
  );
});

test("a clan report subject says the war place and the churn", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const { subject, preheader } = renderMail("clan_report", facts, links);
  assert.equal(
    subject,
    "POAP KINGS, Sep 21 – 28: 1st in war, 4 left, 2 joined",
  );
  assert.match(preheader, /^10,305 fame, over the line on war day 3\./);
  // An issue stored before the redesign keeps its subject.
  assert.equal(
    renderMail("clan_report", stored("clan_report-2026-09"), links).subject,
    "POAP KINGS, Sep 7 – 14: 1st in war, 3 left, 3 joined",
  );
});

test("a clan report names each day in its reader's zone; an issue stored with a day label still renders", () => {
  // Review 2026-09-27 §6.7: composed once for everyone, the report had
  // named days in the first tracker's zone. The stored issue predates
  // the week's structured moves, so its standouts carry the {{day:}}.
  const facts = stored("clan_report-2026-09");
  facts.membership.joined = [
    { tag: "#A", name: "Late", at: "2026-09-09T03:00:00Z" },
    { tag: "#B", name: "Old", when: "Fri" },
  ];
  facts.standouts = [
    {
      tag: "#A",
      name: "Late",
      text: "9 battles in one {{day:2026-09-09T03:00:00Z}} sitting",
    },
  ];
  const utc = renderMail("clan_report", facts, links).html;
  const chicago = renderMail("clan_report", facts, {
    ...links,
    timezone: "America/Chicago",
  }).html;
  assert.match(utc, />Wed 3:00 am\.</);
  assert.match(utc, /one Wed sitting/);
  assert.match(chicago, />Tue 10:00 pm\.</);
  assert.match(chicago, /one Tue sitting/);
  for (const html of [utc, chicago]) {
    assert.match(html, />Fri\.</);
    assert.ok(!html.includes("{{day:"), "every day token is filled");
  }
  // The finish line too: an instant, named in each reader's zone.
  const now = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  assert.match(
    renderMail("clan_report", now, { ...links, timezone: "America/Chicago" })
      .html,
    /over the line Sun 4:38 am/,
  );
});

test("a clan report marks the reader's own players, and nobody else's", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const chip = />you<\/span>/;
  const mine = renderMail("clan_report", facts, {
    ...links,
    mine: ["#20JJJ2CCRU"],
  }).html;
  // King Thing raced eighth-from-last: past the top five, so the row is
  // there because it is the reader's.
  assert.ok(mine.includes("King Thing"), "the reader's own row");
  assert.match(mine, chip);
  const theirs = renderMail("clan_report", facts, links).html;
  assert.ok(!chip.test(theirs), "no chip without the reader's players");
  assert.ok(!theirs.includes(">King Thing<"), "and only the top five");
  // The facts are the same for everyone: the chip is the render's.
  assert.ok(!JSON.stringify(facts).includes('"mine"'));
});

test("a 50-member clan's report stays under Gmail's clip", () => {
  // Gmail clips a message past about 102 KB and hides the rest behind
  // "View entire message", footer and unsubscribe included. The roster
  // table is what pushed a full clan past it; the report now links the
  // roster instead, and every list in it is capped.
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const member = (i) => ({
    tag: `#M${String(i).padStart(7, "0")}`,
    name: `Member with a long name ${i} ♥️✨`,
  });
  facts.clan.members = 50;
  facts.headline.of = 50;
  facts.war.raced = Array.from({ length: 50 }, (_, i) => ({
    ...member(i),
    points: 3000 - i * 10,
    decks: 16,
  }));
  facts.membership.joined = Array.from({ length: 25 }, (_, i) => ({
    ...member(100 + i),
    at: "2026-09-23T17:38:00Z",
    role: "member",
    note: null,
  }));
  facts.membership.left = Array.from({ length: 25 }, (_, i) => ({
    ...member(200 + i),
    at: "2026-09-25T17:38:00Z",
    role: "elder",
    tenure_days: 100 + i,
  }));
  facts.membership.roles = Array.from({ length: 20 }, (_, i) => ({
    ...member(i),
    from: "member",
    to: "elder",
    at: "2026-09-24T17:38:00Z",
  }));
  facts.presence.quiet = Array.from({ length: 30 }, (_, i) => ({
    name: member(300 + i).name,
    days: 7 + i,
  }));
  facts.presence.returned = Array.from({ length: 20 }, (_, i) => ({
    name: member(400 + i).name,
    days: 7 + i,
  }));
  const many = (k) => ({
    items: Array.from({ length: 50 }, (_, i) => ({
      ...member(i),
      to: "Master 3",
      best: 9000 + i,
    })),
    more: k,
  });
  facts.week_moves.ranked = many(10);
  facts.week_moves.arena = many(10);
  facts.week_moves.bests = many(10);
  facts.badges = Array.from({ length: 8 }, (_, i) => ({
    name: member(i).name,
    badge: "Classic Challenge, level 3",
  }));
  const { html } = renderMail("clan_report", facts, {
    ...links,
    send_id: "3f2a9c1b-0000-4000-8000-000000000001",
    mine: ["#M0000049"],
  });
  const bytes = Buffer.byteLength(html, "utf8");
  assert.ok(bytes < 95_000, `${bytes} bytes`);
});

test("one shell: the wordmark, the product pill, the why-line in the reader's zone, the turn-off on a bulk kind", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const html = renderMail("clan_report", facts, {
    ...links,
    timezone: "America/Chicago",
  }).html;
  assert.match(html, />Elixir</, "the wordmark is Elixir");
  assert.ok(!/Elixir MCP|ELIXIR/.test(html), "never the old wordmark");
  assert.ok(html.includes("Clan · Monday"), "the pill");
  // 14:00 UTC is 9:00 am in daylight time and 8:00 am in standard.
  assert.match(
    html,
    /You get this on Mondays at [89]:00 am Central, for each clan you track\./,
  );
  assert.match(html, /Turn off the clan report/);
  const utc = renderMail("clan_report", facts, links).html;
  assert.match(utc, /on Mondays at 2:00 pm UTC/);
  // Mail is tables: no flex, no grid, no background image anywhere.
  for (const { kind, facts: f } of allFixtures()) {
    const out = renderMail(kind, f, links).html;
    assert.ok(!/display:\s*(flex|grid)/.test(out), `${kind}: no flex or grid`);
    assert.ok(!/background-image|url\(/.test(out), `${kind}: no backgrounds`);
    assert.ok(!/data:image/.test(out), `${kind}: no data URIs`);
  }
});

test("the friends mail is called what it is: Your friends this week (Jamie, 2026-10-01)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const out = renderMail("tracking_report", facts, links);
  assert.equal(KIND_LABELS.tracking_report, "Your friends this week");
  assert.match(out.subject, /^Your friends this week/);
  assert.ok(!/Tracking report/.test(out.html));
  assert.match(out.html, /Turn off Your friends this week/);
});

test("the weekly send times are the EventBridge crons", () => {
  const template = readFileSync(
    path.join(here, "../../../infra/template.yaml"),
    "utf8",
  );
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const crons = new Map();
  for (const m of template.matchAll(
    /ScheduleExpression: cron\((\d+) (\d+) \? \* (\w+) \*\)\n(?:.*\n){0,8}?\s*Input: '\{"email": "(\w+)"\}'/g,
  ))
    crons.set(m[4], {
      day: DAYS.indexOf(m[3]),
      hour: Number(m[2]),
      minute: Number(m[1]),
    });
  for (const [kind, slot] of Object.entries(MAIL_SCHEDULE)) {
    if (isRetiredEmailKind(kind)) assert.equal(crons.has(kind), false);
    else assert.deepEqual(slot, crons.get(kind), kind);
  }
  assert.equal(Object.keys(MAIL_SCHEDULE).length, 4);
});

test("renderMail refuses a kind it does not know and a send without links", () => {
  for (const kind of ["newsletter", "top_100", "card_of_week"])
    assert.throws(() => renderMail(kind, {}, links), /unknown kind/);
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

test("unsubscribe links have their own key, and links sent before it still work (#71)", () => {
  const accountId = "8b6a2b6e-0c3c-4b3a-9a0e-2f1f8f2d9c11";
  const issuedAt = 1_758_000_000_000;
  const legacy = signUnsubscribe({
    secret: "session-old",
    accountId,
    kind: "all",
    issuedAt,
  });
  assert.equal(legacy.split(".").length, 2, "no key id: the older kind");

  const keys = {
    unsubscribe: "unsub-key",
    session: ["session-new", "session-old"],
  };
  const keyed = signUnsubscribe({
    secret: keys,
    accountId,
    kind: "all",
    issuedAt,
  });
  assert.ok(keyed.startsWith(`${UNSUBSCRIBE_KEY_ID}.`));
  assert.equal(
    verifyUnsubscribe({ secret: keys, token: keyed })?.accountId,
    accountId,
  );
  assert.equal(
    verifyUnsubscribe({ secret: keys, token: legacy })?.accountId,
    accountId,
    "a link signed with the previous session secret still unsubscribes",
  );
  // The session secret rotates on: keyed links do not care.
  const rotated = { unsubscribe: "unsub-key", session: ["session-newer"] };
  assert.ok(verifyUnsubscribe({ secret: rotated, token: keyed }));
  assert.equal(verifyUnsubscribe({ secret: rotated, token: legacy }), null);
  // A keyed token is never checked against a session secret, nor the
  // reverse.
  assert.equal(verifyUnsubscribe({ secret: "unsub-key", token: keyed }), null);
  assert.equal(
    verifyUnsubscribe({
      secret: { unsubscribe: "session-old", session: [] },
      token: legacy,
    }),
    null,
  );
  assert.equal(verifyUnsubscribe({ secret: null, token: keyed }), null);
  assert.throws(
    () =>
      signUnsubscribe({
        secret: { unsubscribe: null, session: null },
        accountId,
        kind: "all",
      }),
    /no secret/,
  );
});

test("cardAsset is the mirror's one original file per card and form", () => {
  // Jamie, 2026-10-08: "you cannot resize the images or alter them in
  // anyway." The mail sizes the original with width and height.
  const base = "https://elixir.poapkings.com/assets/cards/";
  assert.equal(cardAsset(26000021, "base"), `${base}26000021.png`);
  assert.equal(cardAsset(26000021, null), `${base}26000021.png`);
  assert.equal(cardAsset(26000021, "evolution"), `${base}26000021_evo.png`);
  assert.equal(cardAsset(26000021, "hero"), `${base}26000021_hero.png`);
});

test("every card image in every mail is an original, sized by width and height", () => {
  for (const { name, kind, facts } of allFixtures()) {
    if (isRetiredEmailKind(kind)) continue;
    const { html } = renderMail(kind, facts, links);
    for (const img of html.match(
      /<img [^>]*src="[^"]*\/assets\/cards\/[^"]*"[^>]*>/g,
    ) ?? []) {
      assert.match(
        img,
        /\/assets\/cards\/\d+(_evo|_hero)?\.png"/,
        `${name}: ${img}`,
      );
      assert.match(img, /width="\d+" height="\d+"/, `${name}: ${img}`);
      assert.doesNotMatch(img, /srcset/, name);
    }
  }
});

test("an Evo or Hero the mirror lacks draws the base card's original, chosen at compose time", async () => {
  // A mail client cannot fall back the way a page does; Supercell lists
  // a form about two weeks before its image answers (Hero Electro
  // Wizard on 2026-10-08).
  const facts = {
    deck: {
      cards: [
        { id: 26000042, name: "Electro Wizard", form: "hero" },
        { id: 26000059, name: "Royal Hogs", form: "evolution" },
        { id: 26000012, name: "Skeleton Army", form: "base" },
      ],
    },
    at: new Date("2026-10-08T00:00:00Z"),
  };
  const asked = [];
  const held = async (p) => {
    asked.push(p);
    return p === "/assets/cards/26000059_evo.png";
  };
  const out = await resolveCardArt(facts, held);
  const [wizard, hogs, army] = out.deck.cards;
  assert.equal(wizard.art_src, cardAsset(26000042, "base"));
  assert.equal(wizard.form, "hero", "the alt still names the form played");
  assert.equal(hogs.art_src, undefined, "a held form draws its own art");
  assert.equal(army.art_src, undefined, "a base card is never asked about");
  assert.deepEqual(asked.sort(), [
    "/assets/cards/26000042_hero.png",
    "/assets/cards/26000059_evo.png",
  ]);
  assert.ok(out.at instanceof Date);
  assert.equal(facts.deck.cards[0].art_src, undefined, "input unchanged");
  // A failing check reads as missing: the base card, never a broken image.
  const failed = await resolveCardArt(facts, async () => {
    throw new Error("AccessDenied");
  });
  assert.equal(failed.deck.cards[1].art_src, cardAsset(26000059, "base"));
});

test("the drawn image is the base card's, with the form's name as its alt", async () => {
  const facts = stored("milestone-cards");
  const hero = facts.milestones.find(
    (m) => m.card?.form && m.card.form !== "base",
  );
  const subject = hero ?? facts.milestones[0];
  const card = { ...subject.card, form: "hero" };
  const resolved = await resolveCardArt(
    { ...facts, milestones: [{ ...subject, card }] },
    async () => false,
  );
  const { html } = renderMail("milestone", resolved, links);
  assert.ok(html.includes(`/assets/cards/${card.id}.png"`));
  assert.ok(!html.includes(`/assets/cards/${card.id}_hero.png`));
  assert.match(
    html,
    new RegExp(
      `alt="Hero ${card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
});

test("cards unlocked are their art, each a link to the card's page in Elixir", () => {
  const facts = stored("milestone-cards");
  const { subject, preheader, html } = renderMail("milestone", facts, links);
  assert.match(html, /Big Thing unlocked three cards/);
  for (const m of facts.milestones) {
    assert.ok(
      html.includes(`/assets/cards/${m.card.id}.png`),
      `${m.card.name}'s art`,
    );
    assert.match(html, new RegExp(`href="[^"]*/cards/${m.card.id}\\?`));
    assert.ok(preheader.includes(m.card.name));
  }
  assert.ok(subject.length > 0);
});

test("a milestone that a battle did names the battle: the opponent, the score, the trophies", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "milestone.json"), "utf8"),
  );
  const b = facts.milestones[0].battle;
  assert.ok(b, "the fixture's promotion carries its battle");
  const { html } = renderMail("milestone", facts, links);
  assert.match(html, /The battle that did it/);
  assert.ok(html.includes(esc(b.opponent.name)), "the opponent, named");
  assert.ok(
    html.includes(`${b.crowns}–${b.crowns_against}`),
    "the score as it ended",
  );
});

test("the battle that did it opens its page, and a stored issue without the link still renders", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "milestone.json"), "utf8"),
  );
  const { url } = facts.milestones[0].battle;
  assert.equal(url, "https://elixir.poapkings.com/battle/aad68079b0fa");
  const { html } = renderMail("milestone", facts, links);
  assert.match(
    html,
    /<a href="https:\/\/elixir\.poapkings\.com\/battle\/aad68079b0fa\?utm_source=email[^"]*"[^>]*>See the battle ›<\/a>/,
  );
  // The button opens the player's own season on Ladder: the season the
  // milestone happened in, so an old mail still opens that season.
  assert.match(html, />Open Big Thing in Ladder</);
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/ladder\?player=VJG0J29QP&amp;season=136&amp;utm_source=email/,
  );
  delete facts.milestones[0].battle.url;
  delete facts.season;
  const old = renderMail("milestone", facts, links).html;
  assert.match(old, /The battle that did it/);
  assert.doesNotMatch(old, /See the battle/);
  // Stored before the season was on it: Ladder's own default.
  assert.match(old, /\/ladder\?player=VJG0J29QP&amp;utm_source=email/);
});

test("the Arena week opens Ladder: the season, and every deck on Ladder › Decks", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "arena_week.json"), "utf8"),
  );
  const { html } = renderMail("arena_week", facts, links);
  assert.match(html, />Open King Thing in Ladder</);
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/ladder\/decks\?player=20JJJ2CCRU&amp;season=136&amp;utm_source=email[^"]*"[^>]*>Ladder › Decks<\/a>/,
  );
  // Both open the season the week was in, not whatever runs on the day
  // the mail is read (2026-10-08).
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/ladder\?player=20JJJ2CCRU&amp;season=136&amp;utm_source=email[^"]*"[^>]*>Open King Thing in Ladder/,
  );
  assert.doesNotMatch(html, /in the console</);
});

test("the clan report links the race's own week, by Season and Week", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  const { html } = renderMail("clan_report", facts, links);
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/console\/explore\/week\/J2RGCRVG~136~2\?utm_source=email[^"]*"[^>]*>the week’s page<\/a>/,
  );
  assert.match(html, /Season 136, week 3 are on/);
  // No race, no week link.
  const quiet = renderMail(
    "clan_report",
    { ...facts, war: { present: false } },
    links,
  ).html;
  assert.doesNotMatch(quiet, /explore\/week\//);
});

test("each collector is its card, with what it is doing now", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "collector_activity.json"), "utf8"),
  );
  facts.collectors[1] = {
    ...facts.collectors[1],
    state: "silent",
    since: "2026-09-26T21:40:00Z",
  };
  const { subject, preheader, html } = renderMail(
    "collector_activity",
    facts,
    links,
  );
  assert.equal(
    subject,
    "Your collectors, Sep 20 – 27: 4 running, 1 silent, 1 stopped",
  );
  for (const x of facts.collectors)
    assert.ok(
      html.includes(`/assets/cards/${x.card_id}.png`),
      `${x.name}'s art`,
    );
  assert.match(html, /silent since Sep 26, 9:40 pm/);
  assert.match(html, /stopped on purpose, last checked in on Sep 17/);
  assert.match(preheader, /Royal Hogs has been silent since Sep 26\./);
  assert.match(html, /href="[^"]*\/console\/status\/collectors/);
});

test("a collector issue stored before its cards and states still renders from its status", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "collector_activity.json"), "utf8"),
  );
  for (const x of facts.collectors) {
    delete x.card_id;
    delete x.state;
    delete x.since;
  }
  const { subject, html } = renderMail("collector_activity", facts, links);
  assert.equal(subject, "Your collectors, Sep 20 – 27: 5 running, 1 stopped");
  assert.ok(!html.includes("/assets/cards/"), "no art without a card");
  assert.match(html, /stopped on purpose</);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("actions waiting: one box per action, the app's count of the rest, its link on each", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_actions_waiting.json"), "utf8"),
  );
  facts.lines = [
    ...Array.from({ length: 10 }, (_, i) => `#${60 - i} Welcome: Player ${i}`),
    "And 5 more.",
  ];
  const { html, preheader } = renderMail("clan_actions_waiting", facts, links);
  assert.match(html, /15 actions waiting/);
  assert.match(html, /And 5 more on the Actions page\./);
  assert.equal(html.match(/Decide ›/g).length, 10);
  assert.equal(
    preheader,
    "#60 Welcome: Player 0 · #59 Welcome: Player 1 · #58 Welcome: Player 2",
  );
  const one = renderMail(
    "clan_actions_waiting",
    { ...facts, lines: ["#41 Promote to Elder: God Bless You (new)"] },
    links,
  ).html;
  assert.match(one, /One action waiting/);
  assert.match(one, />new<\/span>/);
  assert.doesNotMatch(one, /\(new\)/);
});

test("collector upgrade notices escape release text and distinguish unknown historical security", () => {
  const facts = {
    event: "upgrade",
    test: true,
    name: "Example collector",
    from_version: "v3.0.4",
    to_version: "v3.0.6",
    observed_at: "2026-09-28T02:18:03Z",
    signature_state: "not_recorded",
    release: {
      release_url:
        "https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/v3.0.6",
      changes: "<script>attack()</script>\nRetry throttled submissions.",
      reason: "Maintainer: improve reliability.",
    },
  };
  const rendered = renderMail("collector_activity", facts, links);
  assert.match(rendered.subject, /TEST.*historical replay/);
  assert.match(rendered.html, /historical observation was not recorded/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(
    rendered.html,
    /installation mechanism on this host was not reported/,
  );
});

test("a clan header keeps a selected closed race's season and week together across rollover, including stored facts", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_report.json"), "utf8"),
  );
  facts.week = {
    ...facts.week,
    label: "Sep 28 – Oct 5",
    season: 137,
    war_week: 1,
  };
  facts.war = { ...facts.war, season: 136, week: 4 };
  const before = structuredClone(facts);
  const { html } = renderMail("clan_report", facts, links);
  assert.match(html, /Sep 28 – Oct 5 · Season 136, river race week 4/);
  assert.doesNotMatch(html, /Season 137/);
  assert.deepEqual(facts, before);
  facts.war = { present: false };
  facts.week.war_week = null;
  assert.match(renderMail("clan_report", facts, links).html, /Season 137/);
});

test("feedback answer: their words clipped and escaped, the answer whole, status and what shipped", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "feedback_answer.json"), "utf8"),
  );
  const { subject, html, preheader } = renderMail(
    "feedback_answer",
    facts,
    links,
  );
  assert.equal(
    subject,
    "Answered: “The global board shows me at rank 1,204 but the game says 1…”",
  );
  assert.match(html, /Your feedback, answered/);
  assert.match(html, /About Ladder · filed/);
  assert.match(html, />Done · shipped in <span[^>]*>11\.3\.0</);
  assert.match(html, /Fixed: ranks now come from the same read/);
  assert.match(preheader, /^Good catch\./);
  const hostile = renderMail(
    "feedback_answer",
    {
      ...facts,
      message: "<img src=x onerror=alert(1)>",
      response: "<script>x()</script>",
      shipped_in: null,
    },
    links,
  ).html;
  assert.doesNotMatch(hostile, /<script>|<img src=x/);
  assert.doesNotMatch(hostile, /shipped in/);
});
