/**
 * clans_participation's table form, the agent's read (#124). The same
 * rows /api/v1 and the console serve as objects, laid out so the
 * eight-week read of a full clan fits the MCP result cap with room:
 *
 * - each row is an array whose entries `columns` names once, in order;
 *   a list of fifty objects repeats every key fifty times, and on the
 *   eight-week read the keys were two fifths of the answer;
 * - a timestamp on a whole second drops its `.000` (still ISO 8601);
 * - `in_clan_at_war_finish` and `role_at_war_finish` are one column,
 *   `place_at_war_finish`: the role where it is known (a role is only
 *   ever known for a member in the clan), else the presence (true in the
 *   clan, false not), else null, unknown.
 *
 * Nothing is dropped: `participationObjects` turns a table back into
 * exactly the objects /api/v1 serves, and a test holds it to that.
 */

/** The columns of a row whose values are instants. */
const INSTANTS = new Set([
  "joined_observed_at",
  "first_joined_at",
  "recorded_since",
  "last_battle_time",
  "last_battle_time_in_clan",
  "left_observed_at",
]);
const PLACE = "place_at_war_finish";
const WHOLE_SECOND = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.000Z$/;
const SECOND_ONLY = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** The table's column names for a list of object-row keys. */
export function tableColumns(keys) {
  const out = [];
  for (const k of keys) {
    if (k === "role_at_war_finish") continue;
    out.push(k === "in_clan_at_war_finish" ? PLACE : k);
  }
  return out;
}

/** Object rows as arrays aligned to `columns` (from tableColumns). A row
 *  key no column holds is a build bug that would lose a field silently,
 *  so it throws. */
export function tabulate(rows, columns) {
  const held = new Set(columns);
  return rows.map((row) => {
    for (const key of Object.keys(row))
      if (
        !held.has(key) &&
        !(
          held.has(PLACE) &&
          (key === "in_clan_at_war_finish" || key === "role_at_war_finish")
        )
      )
        throw new Error(`participation row has ${key}, which no column holds`);
    return columns.map((c) => {
      if (c === PLACE)
        return row.in_clan_at_war_finish.map(
          (inClan, i) => row.role_at_war_finish[i] ?? inClan,
        );
      const v = row[c] === undefined ? null : row[c];
      return INSTANTS.has(c) && typeof v === "string"
        ? v.replace(WHOLE_SECOND, "$1Z")
        : v;
    });
  });
}

/** The objects /api/v1 serves, from the table form: for readers that
 *  want objects (the acceptance suite, tests). A body without `columns`
 *  is returned as it is. */
export function participationObjects(body) {
  if (!body || typeof body !== "object" || !body.columns) return body;
  const out = { ...body };
  delete out.columns;
  for (const [key, cols] of Object.entries(body.columns)) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((row) => {
      if (!Array.isArray(row)) return row;
      const obj = {};
      cols.forEach((c, i) => {
        const v = row[i];
        if (c === PLACE) {
          obj.in_clan_at_war_finish = v.map((p) =>
            typeof p === "string" ? true : p,
          );
          obj.role_at_war_finish = v.map((p) =>
            typeof p === "string" ? p : null,
          );
        } else
          obj[c] =
            INSTANTS.has(c) && typeof v === "string" && SECOND_ONLY.test(v)
              ? v.replace(/Z$/, ".000Z")
              : v;
      });
      return obj;
    });
  }
  return out;
}
