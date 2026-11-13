/**
 * A migration's vacuum list (2026-11-13).
 *
 * A migration that rewrites or bulk-writes a table names it in a line
 * comment the runner reads:
 *
 *   -- vacuum after: battle_participant, battle
 *
 * After every pending migration has committed, the runner (migrate.mjs)
 * runs VACUUM (ANALYZE) on each table named, once, inside a time budget;
 * VACUUM cannot run in a migration's transaction. The comment is part of
 * the file, so it is pinned with it.
 *
 * `vacuumDemands` is the check the rules test applies to every migration
 * after FIRST_CHECKED_MIGRATION: which tables the SQL plainly writes in
 * bulk. It is a heuristic over comment-stripped text, and it says so:
 *
 *  - it sees `update <t> ... set`, `delete from <t>`, `insert into <t>
 *    ... select` (a WITH before the insert included), `create table <t>
 *    as`, and `alter table <t>` with `add column ... default <f(...)>`
 *    (a default that calls anything but now() writes every row; a
 *    constant or now() is catalog-only) or `alter column ... type`
 *    (a rewrite; migration-rules.test.mjs refuses it anyway);
 *  - it skips function bodies (dollar-quoted, except a DO block's, which
 *    runs now) and `insert ... values`, which seeds rows rather than
 *    filling a table;
 *  - it cannot see dynamic SQL (EXECUTE format(...)), a write inside a
 *    function the migration calls, or a qualified name it does not parse.
 *    Those are the author's to declare; the skill says so.
 *
 * It asks for every table, large or small: a vacuum of a small one costs
 * milliseconds, and a size test would be a guess at production's size.
 */

const IDENT = String.raw`"?([a-z_][a-z0-9_]*)"?`;
const QUALIFIED = String.raw`(?:public\.)?${IDENT}`;
const PLAIN = /^[a-z_][a-z0-9_]{0,62}$/;

/** The first migration the demand check reads; earlier files are
 *  applied and immutable, and the ones that bulk-wrote were followed by
 *  a {vacuum} op by hand. */
export const FIRST_CHECKED_MIGRATION = 263;

/** The tables a migration's `-- vacuum after:` lines name, in order,
 *  without repeats. Throws on a name that is not a plain identifier, so
 *  a typo stops loadMigrations (and the rules test) rather than reaching
 *  production as a vacuum of nothing. */
export function declaredVacuum(sql) {
  const out = [];
  for (const m of sql.matchAll(/^[ \t]*--[ \t]*vacuum after:[ \t]*(.*)$/gim)) {
    for (const name of m[1].split(/[\s,]+/).filter(Boolean)) {
      if (!PLAIN.test(name))
        throw new Error(
          `"-- vacuum after:" names "${name}", not a plain lower-case table name`,
        );
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** The SQL as the server runs it now: comments out, string literals
 *  emptied, function bodies out, a DO block's body kept. */
function runnableText(sql) {
  return sql
    .replace(
      /(\bdo\s+)?\$([a-z_]*)\$([\s\S]*?)\$\2\$/gi,
      (_, isDo, _tag, body) => (isDo ? ` do ${body} ` : " "),
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase();
}

/** Stable functions: a column added with one of these as its default
 *  is filled from the catalog, not by writing every row. */
const STABLE_DEFAULTS = new Set([
  "now",
  "current_timestamp",
  "transaction_timestamp",
]);

/** Whether an ALTER TABLE body adds a column whose default calls a
 *  function other than a stable clock: PostgreSQL then writes the value
 *  into every row. */
function volatileDefault(body) {
  for (const m of body.matchAll(
    /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?[a-z_"][a-z0-9_"]*\s[^,]*?\bdefault\s+([^,]*)/g,
  )) {
    for (const call of m[1].matchAll(/(?<!::\s*)\b([a-z_][a-z0-9_]*)\s*\(/g))
      if (!STABLE_DEFAULTS.has(call[1])) return true;
  }
  return false;
}

/** The tables `sql` plainly bulk-writes or rewrites (see the header for
 *  what that means and what it misses), sorted. */
export function vacuumDemands(sql) {
  const text = runnableText(sql);
  const found = new Set();
  const add = (re) => {
    for (const m of text.matchAll(re)) found.add(m[1]);
  };
  // update t set / update only t set / update t alias set / update t as a set
  add(
    new RegExp(
      String.raw`\bupdate\s+(?:only\s+)?${QUALIFIED}\s+(?:(?:as\s+)?[a-z_][a-z0-9_]*\s+)?set\b`,
      "g",
    ),
  );
  add(new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${QUALIFIED}`, "g"));
  // insert into t [(cols)] [overriding ... value] select|with|(select
  add(
    new RegExp(
      String.raw`\binsert\s+into\s+${QUALIFIED}\s*(?:\([^)]*\)\s*)?(?:overriding\s+\w+\s+value\s+)?\(?\s*(?:select|with|table)\b`,
      "g",
    ),
  );
  add(
    new RegExp(
      String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}[^;]*?\bas\s*\(?\s*(?:select|with|table|values)\b`,
      "g",
    ),
  );
  // alter table statements that write every row
  for (const m of text.matchAll(
    new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}([^;]*)`,
      "g",
    ),
  )) {
    const body = m[2];
    if (
      /\balter\s+column\s+[a-z_"][a-z0-9_"]*\s+(?:set\s+data\s+)?type\b/.test(
        body,
      ) ||
      volatileDefault(body)
    )
      found.add(m[1]);
  }
  return [...found].sort();
}
