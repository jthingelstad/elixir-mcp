import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writerPrompt,
  ISSUE_SCHEMA,
  PIPELINE_ADDENDUM,
} from "../src/prompt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the writer runs docs/top100/generator-prompt.md verbatim, then the pipeline addendum", () => {
  const doc = readFileSync(
    path.join(here, "../../../docs/top100/generator-prompt.md"),
    "utf8",
  ).trim();
  const prompt = writerPrompt();
  assert.ok(prompt.startsWith(doc), "the document is the prompt's prefix");
  assert.ok(prompt.endsWith(PIPELINE_ADDENDUM), "the addendum follows it");
  for (const key of ISSUE_SCHEMA.required)
    assert.ok(
      PIPELINE_ADDENDUM.includes(`\`${key}\``) || key === "drought_mode",
      `addendum names ${key}`,
    );
});

test("the gold sample issue passes the lint against its own brief, except for the numbers the sample computed", async () => {
  const { lintIssue } = await import("@elixir-mcp/mail");
  const brief = JSON.parse(
    readFileSync(path.join(here, "../fixtures/sample-brief.json"), "utf8"),
  );
  const gold = readFileSync(
    path.join(here, "../fixtures/sample-issue.md"),
    "utf8",
  );
  const body = gold.slice(
    gold.indexOf("# Elixir Weekly"),
    gold.indexOf("## Why this issue works"),
  );
  const problems = lintIssue(
    {
      subject: "RamboOo held #1 for one day",
      body_markdown: body,
      numbers_used: [],
    },
    brief,
  );
  // The hand-written sample prints deltas it subtracted itself (+702, 625,
  // "roughly 450"); the real brief carries them precomputed. Everything
  // else the lint checks holds on the gold sample.
  assert.ok(
    problems.every((p) => /^number /.test(p)),
    problems.join("; "),
  );
});
