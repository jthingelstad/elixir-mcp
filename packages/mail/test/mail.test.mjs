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
    assert.ok(!/<img/i.test(out.html), `${kind} has no images (pixel-free)`);
    const text = htmlToText(out.html);
    assert.ok(text.length > 200, `${kind} text alternative`);
    assert.ok(!/<[a-z]/i.test(text), `${kind} text has no tags`);
    assert.ok(KIND_LABELS[kind], `${kind} has a label`);
  }
});

test("names are links into Browse, tags only in the title", () => {
  const facts = JSON.parse(
    readFileSync(path.join(fixtures, "arena_week.json"), "utf8"),
  );
  const { html } = renderMail("arena_week", facts, links);
  assert.ok(
    html.includes(
      'href="https://elixir.poapkings.com/explore/player/20JJJ2CCRU"',
    ),
  );
  assert.ok(html.includes('title="#20JJJ2CCRU"'));
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
