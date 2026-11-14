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
import { MAIL_PATHS } from "../src/paths.mjs";

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
// Every kind still sent, one fixture each, named <kind>.json.
const allFixtures = () =>
  readdirSync(fixtures)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f.replace(".json", ""),
      kind: f.replace(".json", ""),
      facts: JSON.parse(readFileSync(path.join(fixtures, f), "utf8")),
    }));
const links = {
  unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
  manage: "https://elixir.poapkings.com/settings/emails",
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
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const { html } = renderMail("tracking_report", facts, links);
  assert.ok(
    html.includes(
      'href="https://elixir.poapkings.com/home/player/20JJJ2CCRU?utm_source=email&utm_medium=tracking_report&utm_campaign=tracking_report-2026-W37"',
    ),
    html.match(/home\/player\/20JJJ2CCRU[^"]*/)?.[0],
  );
  assert.ok(html.includes('title="#20JJJ2CCRU"'));
  // The manage link is tagged; the one-click unsubscribe is not (an API
  // path with no embed, and the ledger records it anyway).
  assert.ok(html.includes("settings/emails?utm_source=email"));
  assert.ok(
    html.includes(
      'href="https://elixir.poapkings.com/api/email/unsubscribe?t=x"',
    ),
  );
});

test("links.pixel false renders tagged links without the open pixel (the public page)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const { html } = renderMail("tracking_report", facts, {
    ...links,
    pixel: false,
  });
  assert.ok(!/tinylytics/i.test(html));
  assert.ok(html.includes(LOGO), "the page still wears the logo");
  assert.ok(html.includes("utm_campaign=tracking_report-2026-W37"));
});

test("links.send_id puts the short mail id in the footer, the whole id in its links; a page render has neither", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const id = "3f2a9c1b-0000-4000-8000-000000000001";
  const { html } = renderMail("tracking_report", facts, {
    ...links,
    send_id: id,
  });
  // Six characters to read, the whole id behind the link: the record and the
  // feedback are tagged like every other link into the site, because a send
  // id is a product identifier and the click is counted per campaign
  // (ENGINEERING, "Product identifiers versus measurement").
  assert.match(html, />Mail 3f2a9c</);
  assert.ok(
    html.includes(`${MAIL_PATHS.record(id)}?utm_source=email`),
    "the mail's record",
  );
  assert.ok(
    html.includes(`${MAIL_PATHS.report(id)}&utm_source=email`) ||
      html.includes(`${MAIL_PATHS.report(id)}&amp;utm_source=email`),
    "feedback with the mail attached",
  );
  // No sponsorship ask (Jamie, 2026-11-11).
  assert.ok(!/sponsor|\/support/i.test(html), "no sponsor line");
  const text = htmlToText(html);
  assert.ok(text.includes(id), "the text alternative carries the id too");
  const page = renderMail("tracking_report", facts, links).html;
  assert.ok(!page.includes(">Mail "));
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
    tagLink("https://elixir.poapkings.com/home/you?v=1", {
      kind: "tracking_report",
      period: "2026-09-18",
    }),
    "https://elixir.poapkings.com/home/you?v=1&utm_source=email&utm_medium=tracking_report&utm_campaign=tracking_report-2026-09-18",
  );
});

test("tagLink tags a link into every product the family's bar names", async () => {
  // The origins come from the kit's product manifest, the list the top
  // bar draws, so a product added there is tagged here with no edit.
  const { tagLink } = await import("../src/index.mjs");
  const { default: shell } = await import("@elixir-mcp/ui/shell.json", {
    with: { type: "json" },
  });
  const campaign = { kind: "milestone", period: "2026-09-19" };
  assert.ok(shell.products.length > 0);
  for (const p of shell.products) {
    const url = new URL(p.href ?? p.path, shell.origin).href;
    assert.match(tagLink(url, campaign), /[?&]utm_source=email&/, p.key);
  }
  // Drop is on a host of its own, and its links are still ours.
  assert.equal(
    tagLink("https://drop.poapkings.com/play", campaign),
    "https://drop.poapkings.com/play?utm_source=email&utm_medium=milestone&utm_campaign=milestone-2026-09-19",
  );
});

test("one shell: the wordmark, the product source, the why-line in the reader's zone, the turn-off on a bulk kind", () => {
  const digest = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const html = renderMail("tracking_report", digest, links).html;
  assert.match(html, />Elixir</, "the wordmark is Elixir");
  assert.ok(!/Elixir MCP|ELIXIR/.test(html), "never the old wordmark");
  assert.ok(html.includes(">Home</span>"), "the product source");
  assert.match(html, /Turn off this mail/);
  // The digest's why-line is in the reader's zone: 11:00 UTC is 6:00 am
  // in daylight time and 5:00 am in standard.
  assert.match(
    renderMail("tracking_report", digest, {
      ...links,
      timezone: "America/Chicago",
    }).html,
    /You get this on Mondays at [56]:00 am Central/,
  );
  assert.match(
    renderMail("tracking_report", digest, links).html,
    /on Mondays at 11:00 am UTC/,
  );
  // Mail is tables: no flex, no grid, no background image anywhere.
  for (const { kind, facts: f } of allFixtures()) {
    const out = renderMail(kind, f, links).html;
    assert.ok(!/display:\s*(flex|grid)/.test(out), `${kind}: no flex or grid`);
    assert.ok(!/background-image|url\(/.test(out), `${kind}: no backgrounds`);
    assert.ok(!/data:image/.test(out), `${kind}: no data URIs`);
  }
});

test("the digest replaces the friends mail under its kind: Your week in Elixir, weekly by default (#767)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const out = renderMail("tracking_report", facts, {
    ...links,
    timezone: "America/Chicago",
  });
  assert.equal(KIND_LABELS.tracking_report, "Your digest");
  assert.match(
    out.subject,
    /^Your week in Elixir: 3 people you follow, 73 battles$/,
  );
  assert.ok(!/Your friends this week|Tracking report/.test(out.html));
  assert.match(out.html, /Turn off this mail/);
  // The inbox preview leads with a highlight's words.
  assert.match(out.preheader, /^Rapid Clear: “Finally beat the log bait/);
  const text = htmlToText(out.html);
  // A highlight: the timeline's sentence, the words, the battle.
  assert.match(
    text,
    /Rapid Clear highlighted a 3-0 win against Brass Newt \(Trophy Road\)\. See the battle/,
  );
  assert.match(
    text,
    /“Finally beat the log bait I keep losing to\. Three crowns!”/,
  );
  assert.match(
    text,
    /\/battle\/a1b2c3d4e5f6\?utm_source=email&utm_medium=tracking_report/,
  );
  // A moment with no battle on record has no battle link; the rest are counted.
  assert.match(text, /passed 5,000 career wins\.\n/);
  assert.match(text, /2 more on your timeline/);
  assert.match(text, /4 sittings · 23 battles · 15–8/);
  assert.match(text, /1 card unlocked\./);
  // The clans and the reader's own week, then the feed.
  assert.match(text, /Around you/);
  assert.match(text, /You, King Thing/);
  assert.match(text, /With Hare Pelican/);
  assert.match(text, /Open your feed/);
  assert.match(
    text,
    /You get this on Mondays at \d:00 am Central, in a week when someone you follow played or posted, you did, or your clan had news\./,
  );
  assert.doesNotMatch(text, /[A-Za-z0-9]\.\./);
  // Each player once: a followed clanmate is marked, never told twice.
  assert.match(text, /Rapid Clear[^\n]*\n+In POAP KINGS/);
});

test("a daily digest says its day and its cadence (#767)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  facts.cadence = "daily";
  const out = renderMail("tracking_report", facts, {
    ...links,
    timezone: "America/Chicago",
  });
  assert.match(out.subject, /^Your day in Elixir/);
  assert.match(
    htmlToText(out.html),
    /You get this each day at \d:00 am Central, in a day when someone you follow/,
  );
});

test("the digest: a clan is a headline and at most three bullets, and a full stop never doubles (Jamie, 2026-10-08)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "tracking_report.json"), "utf8"),
  );
  const text = htmlToText(renderMail("tracking_report", facts, links).html);
  const block = text.slice(
    text.indexOf("Around you"),
    text.indexOf("You, King Thing"),
  );
  // The clan's own news only (2026-11-12): its race, its roster, roles;
  // never its battles, which are told under each person.
  assert.match(
    block,
    /River race \(season 136, week 3\): finished 1st with 10,305 fame\.\n/,
  );
  assert.equal(block.match(/^• /gm)?.length, 3, block);
  assert.match(block, /^• Departed: Cy$/m);
  assert.doesNotMatch(block, /battles|quiet/);
  assert.doesNotMatch(text, /[A-Za-z0-9]\.\./);
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
  // The digest's rule fires every day; it keeps Monday for the
  // weekly default (runDigest's DIGEST_WEEKLY_DAY).
  for (const m of template.matchAll(
    /ScheduleExpression: cron\((\d+) (\d+) \* \* \? \*\)\n(?:.*\n){0,8}?\s*Input: '\{"email": "(\w+)"\}'/g,
  ))
    crons.set(m[3], {
      day: 1,
      hour: Number(m[2]),
      minute: Number(m[1]),
      daily: true,
    });
  for (const [kind, slot] of Object.entries(MAIL_SCHEDULE)) {
    if (isRetiredEmailKind(kind)) assert.equal(crons.has(kind), false);
    else assert.deepEqual(slot, crons.get(kind), kind);
  }
  // One scheduled digest and the operators' collector mail (2026-11-12).
  assert.deepEqual(Object.keys(MAIL_SCHEDULE).sort(), [
    "collector_activity",
    "tracking_report",
  ]);
  assert.equal(MAIL_SCHEDULE.tracking_report.daily, true);
});

test("renderMail refuses a kind it does not know and a send without links", () => {
  // The retired kinds have no renderer: a sent one's record shows the
  // archived mail (2026-11-13). top_100 and card_of_week are no kind at
  // all since 2026-11-14.
  for (const kind of [
    "newsletter",
    "top_100",
    "card_of_week",
    "clan_report",
    "arena_week",
    "milestone",
  ])
    assert.throws(() => renderMail(kind, {}, links), /unknown kind/);
  assert.throws(() => renderMail("tracking_report", {}, {}), /links/);
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

test("each collector is its card, with what it is doing now", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "collector_activity.json"), "utf8"),
  );
  facts.collectors[1] = {
    ...facts.collectors[1],
    state: "silent",
    since: "2026-09-26T21:40:00Z",
  };
  const { subject, preheader, html } = renderMail("collector_activity", facts, {
    ...links,
    now: Date.parse("2026-10-20T00:00:00Z"),
  });
  assert.equal(
    subject,
    "Your collectors, Sep 19 – 25: 4 running, 1 silent, 1 stopped",
  );
  for (const x of facts.collectors)
    assert.ok(
      html.includes(`/assets/cards/${x.card_id}.png`),
      `${x.name}'s art`,
    );
  assert.match(html, /silent since Sat Sep 26, 9:40 pm UTC/);
  assert.match(html, /stopped on purpose, last checked in on Sep 17/);
  assert.match(preheader, /Royal Hogs has been silent since Sep 26\./);
  assert.match(html, /href="[^"]*\/settings\/collectors/);
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
  assert.equal(subject, "Your collectors, Sep 19 – 25: 5 running, 1 stopped");
  assert.ok(!html.includes("/assets/cards/"), "no art without a card");
  assert.match(html, /stopped on purpose</);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("the collector mail says the limits, never points or credits (#539)", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "collector_activity.json"), "utf8"),
  );
  const { html, preheader } = renderMail("collector_activity", facts, links);
  assert.match(html, /Your limits/);
  assert.match(html, /raises your limits to Family/);
  assert.match(html, /fetches with new facts/);
  assert.match(
    preheader,
    /Your active collector raises your limits to Family\./,
  );
  assert.doesNotMatch(html, /points|credits?\b/i);

  // An issue stored before 2026-10-12 carried points and credits: it
  // renders without them, and without a tier line it never knew.
  const old = structuredClone(facts);
  delete old.tier;
  old.credits = { week: 42, lifetime: 900 };
  for (const x of old.collectors) {
    delete x.adding_fetches;
    x.lifetime_points = 4639;
  }
  const stored = renderMail("collector_activity", old, links);
  assert.doesNotMatch(stored.html, /points|credits?\b|Your limits/i);
  assert.doesNotMatch(stored.html, /undefined|NaN/);
});

test("actions waiting: action rows, the app's count of the rest, and one primary action", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_actions_waiting.json"), "utf8"),
  );
  facts.lines = [
    ...Array.from({ length: 10 }, (_, i) => `#${60 - i} Welcome: Player ${i}`),
    "And 5 more.",
  ];
  const { html, preheader } = renderMail("clan_actions_waiting", facts, links);
  assert.match(html, /15 actions waiting/);
  assert.match(html, /And 5 more in .*\/feed.*Clan › Feed/);
  assert.doesNotMatch(html, /Decide ›/);
  assert.equal(html.match(/>Review in Clan</g).length, 1);
  assert.equal(
    preheader,
    "#60 Welcome: Player 0 · #59 Welcome: Player 1 · #58 Welcome: Player 2 · #57 Welcome: Player 3",
  );
  const one = renderMail(
    "clan_actions_waiting",
    { ...facts, lines: ["#41 Promote to Elder: Newt Quiet (new)"] },
    links,
  ).html;
  assert.match(one, /One action waiting/);
  assert.match(one, />· New<\/span>/);
  assert.doesNotMatch(one, /\(new\)/);
});

test("an action in mail: its title, its reason, a link to it, and never its number", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "clan_actions_waiting.json"), "utf8"),
  );
  const at = "2026-10-20T15:00:00.000Z";
  const out = renderMail(
    "clan_actions_waiting",
    {
      ...facts,
      lines: [
        {
          title: "Welcome: Player",
          reason: `Joined {{when:${at}}}. Welcome them in clan chat.`,
          number: 92,
          new: true,
        },
        { title: "Promote to Elder: Player Two", reason: "", number: 93 },
      ],
    },
    { ...links, timezone: "America/Chicago" },
  );
  const tag = facts.clan.tag.slice(1);
  assert.ok(
    out.html.includes(`/clan/${tag}/actions/92?`),
    "the row's own page",
  );
  assert.doesNotMatch(out.html, /#92\b|\{\{when/);
  assert.match(out.html, /Joined [^<]*\. Welcome them in clan chat\./);
  assert.match(out.html, />· New<\/span>/);
  assert.match(out.preheader, /Welcome: Player/);
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
  assert.match(rendered.subject, /^\[Test replay\] /);
  assert.match(rendered.html, /historical observation was not recorded/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(
    rendered.html,
    /installation mechanism on this host was not reported/,
  );
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
    "Answered: “The Arena week is missing the deck I played on Saturday.”",
  );
  assert.match(html, /Your feedback, answered/);
  assert.match(html, /About Stats · filed/);
  assert.match(html, />Done · shipped in <span[^>]*>11\.3\.0</);
  assert.match(
    html,
    /Fixed: the deck and battle sections now use the same game week/,
  );
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
  // needs_info (11.10.0, feedback #378): a question, labelled as one.
  const asked = renderMail(
    "feedback_answer",
    { ...facts, status: "needs_info", shipped_in: null },
    links,
  );
  assert.match(asked.subject, /^A question about: “The Arena week/);
  assert.match(asked.html, /A question about your feedback/);
  const shippedQuestion = renderMail(
    "feedback_answer",
    { ...facts, status: "needs_info", shipped_in: "11.13.0" },
    links,
  );
  assert.match(shippedQuestion.html, /Shipped in <span[^>]*>11\.13\.0</);
});

test("the actions mail says Clan, not Elixir Clan", () => {
  const actions = renderMail(
    "clan_actions_waiting",
    {
      clan: { tag: "#A", name: "Example" },
      app: "Clan",
      subject: "One action is waiting",
      lines: ["Promote Ann to Elder (new)"],
      link: "https://elixir.poapkings.com/clan",
    },
    links,
  ).html;
  assert.match(actions, /Clan sends this each morning when something new/);
  assert.doesNotMatch(actions, /Elixir Clan sends|morning run/);
});
