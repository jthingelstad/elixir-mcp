import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ACTIVE_PRODUCT_EMAIL_KINDS } from "@elixir-mcp/contracts";
import { mailPreviewCases } from "../scripts/preview-cases.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
test("the offline gallery covers active mail, current event variants and each service notice; its text is what the relay sends", () => {
  const cases = mailPreviewCases();
  assert.equal(new Set(cases.map((x) => x.name)).size, cases.length);
  assert.deepEqual(
    new Set(cases.filter((x) => !x.message).map((x) => x.kind)),
    new Set(ACTIVE_PRODUCT_EMAIL_KINDS),
  );
  for (const name of [
    "login-oauth",
    "login-code-only",
    "collector_activity-upgrade",
    "collector_activity-upgrade-test",
    "clan_report-activity",
    "feedback_answer-needs_info",
    "owner_notify-gateway_silent",
    "owner_notify-gateway_quarantined",
  ])
    assert.ok(
      cases.some((x) => x.name === name),
      name,
    );
  const out = mkdtempSync(path.join(tmpdir(), "elixir-mail-preview-"));
  try {
    execFileSync(process.execPath, [
      path.join(here, "../scripts/preview.mjs"),
      "--out",
      out,
    ]);
    const manifest = JSON.parse(
      readFileSync(path.join(out, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.length, cases.length);
    for (const specimen of cases) {
      const html = readFileSync(
        path.join(out, `${specimen.name}.html`),
        "utf8",
      );
      const text = readFileSync(path.join(out, `${specimen.name}.txt`), "utf8");
      assert.doesNotMatch(
        html,
        /tinylytics|undefined|NaN|\[object Object\]/,
        specimen.name,
      );
      for (const body of [html, text])
        assert.match(body, /not endorsed by Supercell/, specimen.name);
      if (specimen.message) {
        const actual = renderEmail(specimen.message);
        assert.ok(
          text.endsWith(actual.text),
          `${specimen.name}: preview uses the actual text alternative`,
        );
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
