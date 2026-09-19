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
const fixtures = path.join(here, "../fixtures");
const links = {
  unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=x",
  manage: "https://elixir.poapkings.com/account/profile",
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
    // The one image is the Tinylytics pixel, naming the mail, never the reader.
    const imgs = out.html.match(/<img\b/gi) ?? [];
    assert.equal(imgs.length, 1, `${kind} carries exactly the pixel`);
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
  assert.ok(html.includes("account/profile?utm_source=email"));
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
  assert.ok(html.includes(`This email is <span`));
  assert.ok(html.includes(id));
  // The list is linked and tagged; the id itself is never in a link
  // (a per-recipient identifier must not travel in a tagged link).
  assert.ok(
    html.includes(
      "https://elixir.poapkings.com/account/activity/emails?utm_source=email",
    ),
  );
  assert.ok(!/href="[^"]*3f2a9c1b/.test(html));
  const text = htmlToText(html);
  assert.ok(text.includes(id), "the text alternative carries the id too");
  const page = renderMail("milestone", facts, links).html;
  assert.ok(!page.includes("This email is <span"));
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

test("repairNames puts a name the model's JSON mangled back from the brief", async () => {
  const { repairNames } = await import("../src/index.mjs");
  const body =
    'A week ago **Hypno "u2764\ns Hans** held rank 1; TR⚡️Matthew⚡️ climbed.';
  const out = repairNames(body, ["Hypno ❤️ Hans", "TR⚡️Matthew⚡️", "JTR_CR"]);
  assert.ok(out.includes("**Hypno ❤️ Hans**"), out);
  assert.ok(out.includes("TR⚡️Matthew⚡️ climbed"));
});
