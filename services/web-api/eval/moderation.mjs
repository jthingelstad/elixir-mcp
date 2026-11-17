#!/usr/bin/env node
/**
 * The comment check's eval (2026-11-16): every case in
 * moderation-cases.json through the real request (comment-check.mjs
 * moderationRequest) and the real Anthropic client the relay uses, and
 * a score: how many answered as expected, how many refusals named the
 * expected category, what it cost.
 *
 *   node services/web-api/eval/moderation.mjs           every case
 *   node services/web-api/eval/moderation.mjs --runs 3  each case three times
 *
 * The key is ANTHROPIC_API_TOKEN, read from the environment or the
 * repository's `.env` (process.loadEnvFile) into this process only. It is
 * never printed, logged or written. With no key the script says so and
 * stops. Each case costs about a tenth of a cent on the Haiku model.
 * Never run in CI or by the test runner.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createAnthropicClient } from "@elixir-mcp/clan/anthropic.mjs";
import { costOfUse } from "@elixir-mcp/clan/manage/prices.mjs";
import {
  MODERATION_MODEL,
  moderationRequest,
  readVerdict,
} from "../src/comment-check.mjs";
import { filterComment, tidyComment } from "../src/comment-filter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
if (!process.env.ANTHROPIC_API_TOKEN) {
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {
    // No .env: the check below says so.
  }
}
const key = process.env.ANTHROPIC_API_TOKEN;
if (!key) {
  console.error(
    "No ANTHROPIC_API_TOKEN in the environment or .env; nothing run.",
  );
  process.exit(2);
}
const runsAt = process.argv.indexOf("--runs");
const runs =
  runsAt > 0 ? Math.max(1, Number(process.argv[runsAt + 1]) || 1) : 1;

const { cases } = JSON.parse(
  await readFile(path.join(here, "moderation-cases.json"), "utf8"),
);
const client = createAnthropicClient();
let right = 0;
let total = 0;
let catRight = 0;
let catTotal = 0;
let filtered = 0;
let usd = 0;
const misses = [];
for (const c of cases) {
  for (let i = 0; i < runs; i++) {
    total++;
    const body = tidyComment(c.text);
    const cheap = filterComment(body);
    let got;
    if (!cheap.ok) {
      filtered++;
      got = { allow: false, category: cheap.category, stage: "filter" };
    } else {
      const answer = await client.write(
        key,
        moderationRequest(body, {
          about: "A battle King Thing won, 3 crowns to 1.",
        }),
      );
      if (answer.usage)
        usd +=
          costOfUse(
            MODERATION_MODEL,
            answer.usage.input_tokens ?? 0,
            answer.usage.output_tokens ?? 0,
            {
              cacheWrite: answer.usage.cache_creation_input_tokens ?? 0,
              cacheRead: answer.usage.cache_read_input_tokens ?? 0,
            },
          )?.usd ?? 0;
      const v = answer.ok
        ? readVerdict(answer.input)
        : answer.code === "refusal"
          ? { allow: false, category: "declined" }
          : null;
      got = v
        ? { ...v, stage: "model" }
        : { allow: null, category: answer.code ?? "error", stage: "error" };
    }
    const want = c.expect === "allow";
    const ok = got.allow === want;
    if (ok) right++;
    else misses.push({ text: c.text, expect: c.expect, got });
    if (!want && c.category && got.allow === false) {
      catTotal++;
      if (got.category === c.category) catRight++;
    }
  }
}
const allows = cases.filter((c) => c.expect === "allow").length * runs;
const falseRefusals = misses.filter((m) => m.expect === "allow").length;
const missedRefusals = misses.filter((m) => m.expect === "refuse").length;
console.log(
  JSON.stringify(
    {
      model: MODERATION_MODEL,
      runs,
      cases: cases.length,
      checks: total,
      right,
      pass_rate: Number((right / total).toFixed(3)),
      false_refusals: `${falseRefusals}/${allows}`,
      missed_refusals: `${missedRefusals}/${total - allows}`,
      caught_by_filter: filtered,
      category_match: `${catRight}/${catTotal}`,
      usd: Number(usd.toFixed(4)),
      misses,
    },
    null,
    2,
  ),
);
