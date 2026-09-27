/**
 * The lint binds a number to the name beside it (review 2026-09-27
 * §6.7). On the repo's own fixture, rotating the three podium ratings
 * between the three podium players and inventing "up 44 places" used to
 * pass with zero findings: every one of those numbers is somewhere in
 * the brief. This is the regression, with the true podium as its
 * control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintIssue } from "@elixir-mcp/mail";

const here = path.dirname(fileURLToPath(import.meta.url));
const brief = JSON.parse(
  readFileSync(path.join(here, "../fixtures/sample-brief.json"), "utf8"),
);

const issue = (body, numbers_used = []) => ({
  subject: "The podium",
  body_markdown: body,
  numbers_used,
});

const numberFindings = (problems) =>
  problems.filter((p) => /^number |^numbers_used /.test(p));

test("the true podium passes: each rating sits beside its own player", () => {
  const body = [
    "## The podium",
    "",
    "**1. Hypno ❤️ Hans - 2699.** Was #2 a week ago at 2247.",
    "",
    "**2. JTR_CR - 2694.** Entered and went straight to second.",
    "",
    "**3. AK Tanjiro - 2689.** Climbed from #44 to #3.",
    "",
    "The floor of the top 100 is 2434, and the top 10 spans 63 points.",
  ].join("\n");
  assert.deepEqual(
    numberFindings(
      lintIssue(
        issue(body, [
          { claim: "Hans at 2699", brief_path: "podium[0].rating" },
          { claim: "cutoff 2,434", brief_path: "board.cutoff_rating" },
        ]),
        brief,
      ),
    ),
    [],
  );
});

test("the rotated podium and an invented climb fail the lint", () => {
  const body = [
    "## The podium",
    "",
    "**1. Hypno ❤️ Hans - 2694.** Was #2 a week ago at 2247.",
    "",
    "**2. JTR_CR - 2689.** Up 44 places in a week.",
    "",
    "**3. AK Tanjiro - 2699.** Climbed to #3.",
  ].join("\n");
  const problems = numberFindings(lintIssue(issue(body), brief));
  assert.ok(
    problems.some((p) => /2694 beside Hypno ❤️ Hans belongs to JTR_CR/.test(p)),
    problems.join("; "),
  );
  assert.ok(
    problems.some((p) => /2689 beside JTR_CR belongs to AK Tanjiro/.test(p)),
  );
  assert.ok(
    problems.some((p) =>
      /2699 beside AK Tanjiro belongs to Hypno ❤️ Hans/.test(p),
    ),
  );
  // "Up 44 places" sits in JTR_CR's paragraph but is its own sentence:
  // on its own it binds to nobody. Named, it is caught.
  const named = numberFindings(
    lintIssue(issue("JTR_CR is up 44 places in a week."), brief),
  );
  assert.ok(
    named.some((p) => /44 beside JTR_CR belongs to AK Tanjiro/.test(p)),
    named.join("; "),
  );
});

test("a numbers_used claim must print the value at its path", () => {
  const body = "The floor of the top 100 is 2434.";
  const problems = numberFindings(
    lintIssue(
      issue(body, [
        { claim: "floor 2699", brief_path: "board.cutoff_rating" },
        { claim: "the floor", brief_path: "board.cutoff_rating" },
      ]),
      brief,
    ),
  );
  assert.equal(problems.length, 1, problems.join("; "));
  assert.match(problems[0], /floor 2699.*board\.cutoff_rating \(2434\)/);
});

test("a digit inside a name is not a number, and a full stop inside one does not end the sentence", () => {
  const withNames = {
    ...brief,
    movers: {
      ...brief.movers,
      down: [
        {
          name: "YouTube. KAi_CR",
          tag: "#V2GRPU28Y",
          rank_from: 6,
          rank_to: 95,
          rating_delta: 263,
        },
        {
          name: "91至寒❤️和韧✨瓜呱",
          tag: "#VR8YGR8YL",
          rank_from: 24,
          rank_to: 30,
          rating_delta: 57,
        },
      ],
    },
  };
  const body = [
    "| YouTube. KAi_CR | 6 → 95 | +263 |",
    "| 91至寒❤️和韧✨瓜呱 | 24 → 30 | +57 |",
  ].join("\n");
  assert.deepEqual(numberFindings(lintIssue(issue(body), withNames)), []);
});
