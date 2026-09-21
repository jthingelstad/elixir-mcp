/** The suite's assertions, plain and named: a failure message is the
 *  whole report a reader gets. */

import { ERROR_CODES } from "@elixir-mcp/contracts";

export function fail(msg) {
  throw new Error(msg);
}
export function ok(cond, msg) {
  if (!cond) fail(msg);
}
export function eq(actual, expected, msg) {
  if (actual !== expected)
    fail(`${msg}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
export function isInt(v) {
  return Number.isInteger(v);
}

/** An answer, or the refusal as the failure. */
export function answered(r, what) {
  if (r.isError) {
    const e = r.body?.error ?? {};
    fail(
      `${what}: refused ${e.code ?? ""} ${e.message ?? JSON.stringify(r.body).slice(0, 200)}${e.hint ? ` - ${e.hint}` : ""}`,
    );
  }
  return r.body;
}

/** A result_too_large that says what would fit: the #56/#64 behaviour,
 *  an answer in its own right when the ask was a page no one made. */
export function pricedRefusal(r) {
  return (
    r.isError &&
    r.body?.error?.code === "result_too_large" &&
    /a limit of \d+ should fit/.test(r.body.error.hint ?? "")
  );
}

/** Every key anywhere in a value (objects and arrays walked). */
export function deepKeys(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) deepKeys(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  return out;
}

/** Every snake_case string VALUE anywhere in a value: a note that names
 *  `tower_troop` or `roster_and_war_only` names something the response
 *  carries as a value, not a key. */
export function deepValues(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) deepValues(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) deepValues(v, out);
  else if (
    typeof value === "string" &&
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value)
  )
    out.add(value);
  return out;
}

/** The snake_case tokens a note names: `finished_early`, `decks_used`,
 *  `participants[].scoring_decks` (its last segment), `applied.window.partial`
 *  (each segment). A token with no underscore is prose, not a field. */
const TOKEN = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g;
export function noteTokens(notes, { tools = new Set() } = {}) {
  const out = new Set();
  for (const n of notes ?? []) {
    for (const m of String(n).matchAll(/[A-Za-z_][A-Za-z0-9_.[\]]*/g)) {
      const word = m[0].replace(/\[\]/g, "").replace(/\.+$/, "");
      const segs = word.split(".");
      // `rankings_clans.rated_players` is that tool's field, pointed at.
      if (segs.length > 1 && tools.has(segs[0])) continue;
      for (const seg of segs)
        for (const t of seg.matchAll(TOKEN)) out.add(t[0]);
    }
  }
  return out;
}

/** Words notes use that are vocabulary, not fields: error codes, enum
 *  values, argument names every tool shares, prose idioms. Kept short
 *  on purpose; a case allows its own beyond these. */
export const VOCABULARY = new Set([
  // the error enum: a note that names a refusal names a code
  ...ERROR_CODES,
  // arguments shared by every tool
  "player_tag",
  "clan_tag",
  "season_id",
  "section_index",
  "on_behalf_of",
  "from_to",
  "min_battles",
  "fit_for",
  "group_by",
  "trophy_band",
  "rival_tags",
  "mark_read",
  "elixir_docs",
  // error codes and enum values notes cite
  "not_recorded",
  "not_found",
  "bad_request",
  "query_timeout",
  "result_too_large",
  "insufficient_sample",
  "not_owned",
  "form_not_unlocked",
  "neutral_0",
  "corpus_window",
  "training_day",
  "period_unknown",
  "war_day_over",
  // idioms
  "per_deck",
  "points_per",
  "day_by_day",
  "one_size",
]);

/** Every field a response's notes name is somewhere on the response,
 *  or an argument of the tool, or vocabulary - the finished_early class
 *  of defect (documented and named on every response, served on none). */
export function notesNameFields(ctx, tool, body, { allow = [] } = {}) {
  const keys = deepKeys(body);
  const args = new Set(
    Object.keys(ctx.tools.get(tool)?.inputSchema?.properties ?? {}),
  );
  const allowed = new Set(allow);
  // A note may point at another tool by name.
  const missing = [
    ...noteTokens(body.notes, { tools: new Set(ctx.tools.keys()) }),
  ].filter(
    (t) =>
      !keys.has(t) &&
      !args.has(t) &&
      !ctx.tools.has(t) &&
      !VOCABULARY.has(t) &&
      !allowed.has(t),
  );
  ok(
    missing.length === 0,
    `${tool}: notes name ${missing.join(", ")} and the response carries no such field`,
  );
}

/** Every row carries the key (present, whatever its value). */
export function everyRowHas(rows, key, what) {
  ok(Array.isArray(rows) && rows.length > 0, `${what}: no rows`);
  const without = rows.filter((r) => !(key in r)).length;
  ok(without === 0, `${what}: ${without} of ${rows.length} rows lack ${key}`);
}

export const CLAN = "#J2RGCRVG";
export const JAMIE = "#20JJJ2CCRU";
