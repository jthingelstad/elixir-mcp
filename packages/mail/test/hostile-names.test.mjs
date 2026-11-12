import { test } from "node:test";
import assert from "node:assert/strict";
import { mailPreviewCases } from "../scripts/preview-cases.mjs";
import { renderMail } from "../src/render.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";

// Clash Royale names are free text. Every string a person or the game named
// is replaced by markup here, across the whole gallery of mail: none of it may
// reach the HTML as markup, in text or in an attribute.
const HOSTILE = `<img src=x onerror=alert(1)>"'><b class=HOSTILE>`;
// `words` is a highlight's own words, free text a person wrote (#762).
const NAMED = /name|nick|title|client|opponent|winner|loser|member|words/i;
const links = {
  unsubscribe: "https://elixir.example/u",
  manage: "/settings/emails",
  period: "preview",
  send_id: "00000000-0000-4000-8000-000000000000",
  timezone: "America/Chicago",
  pixel: false,
};

const hostile = (value, key = "") => {
  if (typeof value === "string") return NAMED.test(key) ? HOSTILE : value;
  if (Array.isArray(value)) return value.map((x) => hostile(x, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, hostile(v, k)]),
    );
  return value;
};

test("no mail carries a hostile name as markup", () => {
  let escaped = 0;
  for (const specimen of mailPreviewCases({ retired: true })) {
    const mail = specimen.message
      ? renderEmail({
          v: 1,
          to: "preview@example.org",
          ...hostile(specimen.message),
        })
      : renderMail(specimen.kind, hostile(specimen.facts), links);
    assert.doesNotMatch(
      mail.html,
      /<img src=x|<b class=HOSTILE/,
      specimen.name,
    );
    // The quote that would close an attribute is escaped too.
    assert.doesNotMatch(mail.html, /onerror=alert\(1\)&gt;"/, specimen.name);
    escaped += mail.html.split("&lt;img src=x").length - 1;
  }
  assert.ok(escaped > 100, `the names reached the mail (${escaped})`);
});

test("the digest escapes every string it prints: names, the timeline's sentences and a highlight's words (#767)", () => {
  const [specimen] = mailPreviewCases().filter(
    (c) => c.kind === "tracking_report",
  );
  const facts = structuredClone(specimen.facts);
  const all = [...facts.people, facts.you];
  for (const p of all)
    for (const it of p.items ?? []) {
      it.text = `${HOSTILE} did a thing.`;
      if (it.kind === "battle_highlight") it.words = HOSTILE;
    }
  facts.clans[0].headline = HOSTILE;
  facts.clans[0].bullets = [HOSTILE];
  facts.coverage = HOSTILE;
  const hostileFacts = hostile(facts);
  const mail = renderMail("tracking_report", hostileFacts, links);
  assert.doesNotMatch(mail.html, /<img src=x|<b class=HOSTILE/);
  assert.doesNotMatch(mail.html, /onerror=alert\(1\)&gt;"/);
  // Every name, every sentence, every highlight's words and the clan
  // block reached the mail, as text.
  const count = mail.html.split("&lt;img src=x").length - 1;
  assert.ok(count >= 12, `escaped ${count}`);
  // The subject carries no name at all; the preheader is text.
  assert.doesNotMatch(mail.subject, /<|HOSTILE/);
});
