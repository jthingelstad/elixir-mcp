import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writerPrompt,
  ISSUE_SCHEMA,
  pipelineAddendum,
} from "../src/prompt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("each written kind runs its own document verbatim, then the pipeline addendum", () => {
  for (const [kind, doc] of [
    ["top_100", "docs/top100/generator-prompt.md"],
    ["card_of_week", "docs/card-of-week/generator-prompt.md"],
  ]) {
    const text = readFileSync(path.join(here, "../../..", doc), "utf8").trim();
    const prompt = writerPrompt(kind);
    assert.ok(prompt.startsWith(text), `${kind}: the document is the prefix`);
    assert.ok(
      prompt.endsWith(pipelineAddendum(kind)),
      `${kind}: the addendum follows it`,
    );
    for (const key of ISSUE_SCHEMA.required)
      assert.ok(
        pipelineAddendum(kind).includes(`\`${key}\``),
        `${kind} addendum names ${key}`,
      );
  }
  // The deck placeholder is the whole reason a deck cannot be misspelled;
  // if it leaves the prompt, the writer starts typing card lists.
  assert.match(pipelineAddendum("card_of_week"), /\{\{deck:0\}\}/);
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
