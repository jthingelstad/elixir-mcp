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
 *  decimals rather than for their integer parts.
 *
 *  A number is also BOUND to the names in its sentence (review
 *  2026-09-27 §6.7): beside a name it must belong to that name's object
 *  in the brief, or to no named object at all. Every numbers_used claim
 *  that prints a number must print the value at its path. */

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

/** Every name a written kind's brief carries: the names the writer may
 *  have mangled (repairNames puts them back) and the names a sentence
 *  binds its numbers to (lintIssue). One list per kind, here, so the
 *  editor's draft lint and the jobs Lambda's accept lint read the same. */
export function briefNames(brief, kind = "top_100") {
  const names = new Set();
  if (kind === "card_of_week") {
    names.add(brief?.card?.name);
    for (const p of brief?.partners ?? []) names.add(p.name);
    for (const d of [...(brief?.decks ?? []), brief?.best_of_five].filter(
      Boolean,
    ))
      for (const c of d.cards ?? []) names.add(c.name);
    for (const r of [brief?.rank?.above, brief?.rank?.below].filter(Boolean))
      names.add(r.name);
  } else {
    for (const p of brief?.board?.top100 ?? []) names.add(p.name);
    for (const list of [
      brief?.movers?.up,
      brief?.movers?.down,
      brief?.movers?.entered,
      brief?.movers?.exited,
      brief?.podium,
    ])
      for (const p of list ?? []) names.add(p.name);
    for (const c of brief?.clans ?? []) names.add(c.clan_name);
    if (brief?.deep_cut?.facts?.player) names.add(brief.deep_cut.facts.player);
  }
  return [...names].filter((n) => typeof n === "string" && n);
}

/** Who owns each number in the brief. An object that carries a name
 *  (a board row, a mover, a partner card) owns every number inside it;
 *  a number no named object holds (the cutoff, the median gain, the
 *  season) is the issue's own and may sit beside anyone. Returns
 *  `global` (spellings no name owns) and `owned` (spelling -> names). */
function numberOwners(brief, binding) {
  const global = new Set();
  const owned = new Map();
  const walk = (v, owners) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = new Set();
      spellings(v, s);
      for (const x of s) {
        if (owners.length === 0) global.add(x);
        else {
          if (!owned.has(x)) owned.set(x, new Set());
          for (const o of owners) owned.get(x).add(o);
        }
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, owners));
    else if (v && typeof v === "object") {
      const own = Object.values(v).filter(
        (x) => typeof x === "string" && binding.has(x),
      );
      const next = own.length ? [...new Set([...owners, ...own])] : owners;
      Object.values(v).forEach((x) => walk(x, next));
    }
  };
  walk(brief, []);
  return { global, owned };
}

/** Where the brief's names sit in one line, longest first so a name
 *  inside a longer one is not found twice, and only where it stands as
 *  a word (no ASCII letter or digit touching either end). */
function nameSpans(line, names) {
  const spans = [];
  const taken = (a, b) => spans.some((s) => a < s.end && b > s.start);
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    for (
      let at = line.indexOf(name);
      at !== -1;
      at = line.indexOf(name, at + 1)
    ) {
      const end = at + name.length;
      if (/[A-Za-z0-9_]/.test(line[at - 1] ?? "")) continue;
      if (/[A-Za-z0-9_]/.test(line[end] ?? "")) continue;
      if (taken(at, end)) continue;
      spans.push({ start: at, end, name });
    }
  }
  return spans;
}

/** The body cut into sentences (a table row or a line is one too), each
 *  with the names it carries and its text with those names blanked, so
 *  a digit inside a name ("Pompeyo4.1", "91至寒") is never read as a
 *  number and a full stop inside one ("YouTube. KAi_CR") never ends the
 *  sentence. */
function sentences(body, names) {
  const out = [];
  for (const line of body.split("\n")) {
    const spans = nameSpans(line, names);
    let masked = line;
    for (const s of spans)
      masked =
        masked.slice(0, s.start) +
        "\u0001".repeat(s.end - s.start) +
        masked.slice(s.end);
    let from = 0;
    const cut = (to) => {
      if (to > from)
        out.push({
          text: masked.slice(from, to),
          names: spans
            .filter((s) => s.start >= from && s.start < to)
            .map((s) => s.name),
        });
      from = to;
    };
    for (const m of masked.matchAll(/[.;?!][*_)"'”’]*\s+/g))
      cut(m.index + m[0].length);
    cut(masked.length);
  }
  return out;
}

// A thousands comma sits between digits, never at the end: "2026," in
// "October 1, 2026, UTC" read as a number, missed the year rule, and
// refused the 2026-10-01 issue.
const NUMBER = /(?<![\w#])[+−-]?\d(?:[\d,]*\d)?(?:\.\d+)?(?![\w])/g;

/** Does a printed number trace to a spelling in the set? */
const tracesTo = (raw, set) => set.has(raw) || set.has(raw.replace(/,/g, ""));

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
 *  the brief's names.
 *
 *  It needs two tokens to bracket the damage, a match standing as a
 *  word, and never text that already spells a brief name. A one-token
 *  name matched only its token, so it repaired nothing and rewrote
 *  every other name sharing it: on 2026-10-01 "Dess" turned the
 *  correctly written Dess❤️Rémyy into Dess❤️téø❤️Rémyy and "91" turned
 *  "+914" into "+91至寒❤️和韧✨瓜呱4", and the lint then refused a
 *  true issue for numbers beside the wrong player. */
export function repairNames(body, names) {
  let out = String(body ?? "");
  const known = names.filter((n) => typeof n === "string" && n);
  for (const name of known) {
    if (!/[^\x20-\x7e]/.test(name) || out.includes(name)) continue;
    const tokens = name
      .split(/[^\x21-\x7e]+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (tokens.length < 2) continue;
    // Where the body already spells a brief name; a repair never
    // reaches into one.
    const spelled = [];
    for (const n of known)
      for (let at = out.indexOf(n); at !== -1; at = out.indexOf(n, at + 1))
        spelled.push([at, at + n.length]);
    // The broken escape carries letters ("u2764", a stray "s"), so the
    // gap allows anything, short and non-greedy.
    const re = new RegExp(
      `(?<![A-Za-z0-9_])${tokens.join("[\\s\\S]{1,16}?")}(?![A-Za-z0-9_])`,
      "g",
    );
    out = out.replace(re, (m, at) =>
      spelled.some(([a, b]) => at < b && at + m.length > a) ? m : name,
    );
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

/** Numbers a writer may print without a brief path. */
const STRUCTURAL = ["100", "10", "3", "5", "1", "2", "4", "6", "7", "8", "9"];
const STRUCTURAL_SET = new Set(STRUCTURAL);

/** The spellings of the value at a numbers_used path: a number's own,
 *  every number inside an object, and the digit runs a string carries
 *  (a label like "Sep 12 – 18", an instant). */
function valueSpellings(v) {
  const out = numberSet(v);
  // Digit runs, not NUMBER: an instant ("2026-09-18T10:07:50Z") glues
  // its digits to letters, and a claim prints "September 18".
  if (typeof v === "string")
    for (const m of v.matchAll(/\d+(?:[.,]\d+)*/g)) {
      out.add(m[0]);
      out.add(String(Number(m[0].replace(/,/g, ""))));
    }
  return out;
}

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
  STRUCTURAL.forEach((x) => known.add(x));
  known.add(String(brief?.season?.id ?? ""));
  // A number beside a name must be that name's, or the issue's own.
  // Flattening the brief into one set let the three podium ratings be
  // rotated between the three podium players and pass: every one of them
  // is "in the brief" (review 2026-09-27 §6.7). For Card of the Week the
  // featured card is the issue's subject, so its numbers bind to nobody.
  const names = briefNames(brief, kind);
  const subject = kind === "card_of_week" ? brief?.card?.name : null;
  const binding = new Set(names.filter((n) => n !== subject && n.length >= 3));
  const { global, owned } = numberOwners(brief, binding);
  const structural = new Set(STRUCTURAL);
  structural.add(String(brief?.season?.id ?? ""));
  for (const s of sentences(body, names)) {
    const beside = s.names.filter((n) => binding.has(n));
    // Decimals are scanned WHOLE. Matching the integer part alone let
    // "51.2 percent" be judged as "51" and, worse, let a wrong decimal
    // pass on a right integer.
    for (const m of s.text.matchAll(NUMBER)) {
      const raw = m[0].replace(/^[+−-]/, "");
      if (raw.length < 2) continue;
      if (/^\d{4}$/.test(raw) && Number(raw) >= 2022 && Number(raw) <= 2030)
        continue; // a year
      if (!tracesTo(raw, known)) {
        problems.push(`number ${m[0]} is not in the brief`);
        continue;
      }
      if (!beside.length || tracesTo(raw, structural) || tracesTo(raw, global))
        continue;
      const whose =
        owned.get(raw) ?? owned.get(raw.replace(/,/g, "")) ?? new Set();
      if (beside.some((n) => whose.has(n))) continue;
      problems.push(
        `number ${m[0]} beside ${beside.join(", ")} belongs to ${[...whose].slice(0, 3).join(", ")} in the brief`,
      );
    }
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
  // The self-audit is checked, not just resolved: a claim that prints a
  // number must print the value at the path it names.
  for (const u of issue?.numbers_used ?? []) {
    const v = resolvePath(brief, u.brief_path);
    if (v === undefined) {
      problems.push(`numbers_used path ${u.brief_path} does not resolve`);
      continue;
    }
    const printed = [...String(u.claim ?? "").matchAll(NUMBER)]
      .map((m) => m[0].replace(/^[+−-]/, ""))
      .filter(
        (raw) =>
          raw.length >= 2 &&
          !tracesTo(raw, STRUCTURAL_SET) &&
          !(/^\d{4}$/.test(raw) && Number(raw) >= 2022 && Number(raw) <= 2030),
      );
    if (!printed.length) continue;
    const at = valueSpellings(v);
    if (!printed.some((raw) => tracesTo(raw, at)))
      problems.push(
        `numbers_used claim "${String(u.claim).slice(0, 60)}" does not match ${u.brief_path} (${JSON.stringify(v)?.slice(0, 40)})`,
      );
  }
  if (!issue?.subject || String(issue.subject).length > 78)
    problems.push("subject missing or over 78 characters");
  return [...new Set(problems)];
}
