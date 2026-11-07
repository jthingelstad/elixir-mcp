import { test } from "node:test";
import assert from "node:assert/strict";
import { mailPreviewCases } from "../scripts/preview-cases.mjs";
import { renderMail } from "../src/render.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";

// Clash Royale names are free text. Every string a person or the game named
// is replaced by markup here, across the whole gallery of mail: none of it may
// reach the HTML as markup, in text or in an attribute.
const HOSTILE = `<img src=x onerror=alert(1)>"'><b class=HOSTILE>`;
const NAMED = /name|nick|title|client|opponent|winner|loser|member/i;
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
  for (const specimen of mailPreviewCases()) {
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
