/** The deterministic lint a written issue must pass before it sends
 *  (docs/archive/TOP100-README.md, build order step 3): every number in the
 *  body exists in the brief, every numbers_used path resolves, no bare
 *  tag, no exclamation mark, prose within the kind's length, every
 *  table row that moves a rank carries a rating delta. Pure: the editor
 *  Lambda runs it between its two passes and the jobs Lambda runs it on
 *  acceptance, on the same code.
 *
 *  Rates are why this takes a `kind`. The Top 100 brief is ranks and
 *  ratings, so canonicalising every number as an integer worked; a
 *  brief carrying shares and win rates does not survive it
 *  (`0.511 -> "1"`, and "51.2 percent" then traces to nothing). That
 *  was live: the meta section's usage_share and win_rate ARE rates, so
 *  every percentage the writer printed from them was reported
 *  unsourced and the editor pass — under instruction to remove a number
 *  that does not trace — deleted a true one. It failed quiet, because
 *  the second lint then passed. Numbers are canonicalised at every
 *  spelling a writer would reasonably use, and the body is scanned for
 *  decimals rather than for their integer parts. */

/** How a number may be spelled in prose: the integer forms, the decimal
 *  forms, and — for a rate — its percentage. 0.294 clears "29.4" and
 *  "29"; 4.25 clears "4.3" and "4.25"; 121968 clears "121,968". */
function spellings(v, out) {
  out.add(String(v));
  out.add(String(Math.abs(v)));
  out.add(String(Math.round(v)));
  out.add(String(Math.abs(Math.round(v))));
  if (Number.isInteger(v)) {
    if (Math.abs(v) >= 1000) out.add(Math.abs(v).toLocaleString("en-US"));
    return;
  }
  const a = Math.abs(v);
  out.add(a.toFixed(1));
  out.add(a.toFixed(2));
  // A rate reads as a percentage far more often than as a decimal.
  if (a <= 1) {
    const pct = a * 100;
    out.add(String(Number(pct.toFixed(4))));
    out.add(pct.toFixed(0));
    out.add(pct.toFixed(1));
    out.add(pct.toFixed(2));
    if (pct >= 1000) out.add(Number(pct.toFixed(0)).toLocaleString("en-US"));
  }
}

/** Every number the brief holds, as canonical strings, for the lint. */
function numberSet(v, out = new Set()) {
  if (typeof v === "number" && Number.isFinite(v)) spellings(v, out);
  else if (Array.isArray(v)) v.forEach((x) => numberSet(x, out));
  else if (v && typeof v === "object")
    Object.values(v).forEach((x) => numberSet(x, out));
  return out;
}

function resolvePath(obj, path) {
  return String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Names the model's JSON mangled (an emoji written as a broken escape:
 *  "Hypno "u2764\ns Hans" for "Hypno ❤️ Hans", 2026-09-18) put back from
 *  the brief's spelling: a name with non-ASCII in it is matched by its
 *  ASCII tokens with a short run of anything between them. Bounded to
 *  the brief's names. */
export function repairNames(body, names) {
  let out = String(body ?? "");
  for (const name of names) {
    if (!name || !/[^\x20-\x7e]/.test(name) || out.includes(name)) continue;
    const tokens = name
      .split(/[^\x21-\x7e]+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (tokens.length === 0) continue;
    // The broken escape carries letters ("u2764", a stray "s"), so the
    // gap allows anything, short and non-greedy.
    const re = new RegExp(tokens.join("[\\s\\S]{1,16}?"), "g");
    out = out.replace(re, name);
  }
  return out;
}

/** What differs per kind. `slack` is the margin over `words` the lint
 *  tolerates before refusing, so an issue is not rejected for one
 *  sentence. `floor` catches the opposite failure: an issue the editor
 *  pass cut to nothing still reads as valid to every other rule. */
const KIND_RULES = {
  top_100: { words: 700, slack: 60, floor: 0, pairRankAndRating: true },
  card_of_week: { words: 600, slack: 60, floor: 380, pairRankAndRating: false },
};

/** The deterministic lint. Returns [] when the issue may send. */
export function lintIssue(issue, brief, { kind = "top_100" } = {}) {
  const rules = KIND_RULES[kind] ?? KIND_RULES.top_100;
  const problems = [];
  const body = String(issue?.body_markdown ?? "");
  if (!body.trim()) problems.push("body_markdown is empty");
  if (/!/.test(body.replace(/!\[/g, "")))
    problems.push("exclamation mark in body");
  if (/#[0289PYLQGRJCUV]{5,}/.test(body))
    problems.push("a bare tag appears in the body");
  const prose = body
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l) && !/^#/.test(l))
    .join(" ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  if (words > rules.words + rules.slack)
    problems.push(`prose is ${words} words; the ceiling is ${rules.words}`);
  if (rules.floor && words < rules.floor)
    problems.push(`prose is ${words} words; the floor is ${rules.floor}`);
  const known = numberSet(brief);
  // Structural numbers the writer may print without a brief path.
  [
    "100",
    "10",
    "3",
    "5",
    "1",
    "2",
    "4",
    "6",
    "7",
    "8",
    "9",
    String(brief?.season?.id ?? ""),
  ].forEach((x) => known.add(x));
  // Decimals are scanned WHOLE. Matching the integer part alone let
  // "51.2 percent" be judged as "51" and, worse, let a wrong decimal
  // pass on a right integer.
  for (const m of body.matchAll(
    /(?<![\w#])[+−-]?\d[\d,]*(?:\.\d+)?(?![\w])/g,
  )) {
    const raw = m[0].replace(/^[+−-]/, "");
    if (raw.length < 2) continue;
    if (/^\d{4}$/.test(raw) && Number(raw) >= 2022 && Number(raw) <= 2030)
      continue; // a year
    if (!known.has(raw) && !known.has(raw.replace(/,/g, "")))
      problems.push(`number ${m[0]} is not in the brief`);
  }
  if (rules.pairRankAndRating)
    for (const row of body
      .split("\n")
      .filter((l) => /^\s*\|/.test(l) && /→/.test(l))) {
      if (!/[+−-]\s?\d/.test(row))
        problems.push(
          `table row without a rating delta: ${row.trim().slice(0, 60)}`,
        );
    }
  for (const u of issue?.numbers_used ?? []) {
    const v = resolvePath(brief, u.brief_path);
    if (v === undefined)
      problems.push(`numbers_used path ${u.brief_path} does not resolve`);
  }
  if (!issue?.subject || String(issue.subject).length > 78)
    problems.push("subject missing or over 78 characters");
  return [...new Set(problems)];
}
