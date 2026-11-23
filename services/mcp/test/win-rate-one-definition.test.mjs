import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** The one place a win rate is divided. */
const DEFINITION = "packages/record/src/win-rate-sql.mjs";

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "test")
      continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Code only: comments and quoted strings blanked, line numbers kept.
 * Template literals stay, because that is where the SQL is. A note may
 * state the formula in words; a query or an expression may not compute it.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

// wins (any spelling) over wins, losses, decided or battles: the shape of
// every rate that was computed inline.
const division =
  /\b\w*wins?\b[\w.)\]]*\s*(?:::\w+\s*)?\/\s*(?:nullif\s*\(\s*)?\(?\s*[\w.(]*(?:wins?|loss(?:es)?|decided|battles)\b/gi;

const lineOf = (src, at) => src.slice(0, at).split("\n").length;

function scan(find) {
  const offenders = [];
  for (const dir of ["packages", "services", "apps/web/src"]) {
    for (const file of sourceFiles(path.join(repoRoot, dir))) {
      const rel = path.relative(repoRoot, file);
      if (rel === DEFINITION) continue;
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const at of find(code)) offenders.push(`${rel}:${lineOf(code, at)}`);
    }
  }
  return offenders;
}

/**
 * Win rate has one definition: decided wins over decided battles, where a
 * decided battle is a head-to-head win or loss. A boat attack has no live
 * opponent and a draw no winner, so both are counted in battles and
 * neither is in the rate (docs: reading-the-numbers, "Decided battles and
 * denominators").
 *
 * Until 15.5.0 two readers used the shared definition and nine computed
 * wins / (wins + losses) for themselves, so the same player's week had one
 * rate in battles_performance's window and another in its rows, in
 * battles_decks, battles_cards, players_summary, clans_standings and
 * Scout. The guard reads source, because a tenth reader would have been
 * written the same way.
 */
test("no win rate is divided outside the one definition", () => {
  const offenders = scan((code) =>
    [...code.matchAll(division)].map((m) => m.index),
  );
  assert.deepEqual(
    offenders,
    [],
    `a win rate computed inline: ${offenders.join(", ")}. Count with decidedWinsSql and decidedLossesSql and divide with winRate (${DEFINITION}).`,
  );
});

test("every win_rate a reader builds comes from winRate or a stored rate", () => {
  // `win_rate: <value>`: the value is winRate(...), or a rate already
  // computed and read back (a stored column, another reader's row).
  const built = /(?<![\w.])win_rate\s*:\s*([^\n]*(?:\n[^\n]*)?)/g;
  const offenders = scan((code) =>
    [...code.matchAll(built)]
      .filter((m) => !/\bwinRate\s*\(|win_rate\b|WIN_RATE\b/.test(m[1]))
      .map((m) => m.index),
  );
  assert.deepEqual(
    offenders,
    [],
    `win_rate built without winRate: ${offenders.join(", ")} (${DEFINITION}).`,
  );
});

test("the guard catches the shapes it is for", () => {
  for (const bad of [
    "r.wins / (r.wins + r.losses)",
    "wins::float / nullif(wins + losses, 0)",
    "Number((log.wins / decided).toFixed(3))",
    "sum(wins)::numeric / sum(battles)",
  ]) {
    division.lastIndex = 0;
    assert.ok(division.test(codeOnly(bad)), bad);
  }
  for (const fine of [
    "Math.floor(payload.wins / CAREER_WINS_STEP)",
    "Math.floor(wins / 1000) * 1000",
    'notes.push("win_rate = decided_wins / decided_battles")',
    "// wins / (wins + losses) was the old shape",
  ]) {
    division.lastIndex = 0;
    assert.ok(!division.test(codeOnly(fine)), fine);
  }
});
