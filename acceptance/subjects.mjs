/**
 * The players the suite reads but may not name. Many players are minors,
 * and this repo is public: no real player's tag goes in a committed file
 * except the owner's and the clan's (lib.mjs JAMIE and CLAN). Acceptance
 * needs recorded players, so it cannot invent them either; a catalogue
 * set names a placeholder instead (`$CLANMATE_1`), and the run resolves
 * it from what its own credential can read: the POAP KINGS roster.
 *
 * Resolution is deterministic for the record of the day: members sorted
 * by tag, the owner left out, the first that meet the placeholder's need.
 * A placeholder that cannot be resolved makes its case SKIP with the
 * reason, never fail. The resolved tags are never printed in full: the
 * run prints them masked and writes them to acceptance/subjects.log
 * (ignored by git, mode 0600), the only place they are kept.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAN, JAMIE } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SUBJECTS_LOG = path.join(here, "subjects.log");

/** `$KIND_N`: the Nth player of a kind, 1-based. */
export const PLACEHOLDER = /^\$([A-Z]+)_([1-9][0-9]*)$/;

const DAY_MS = 86_400_000;

/** What each kind needs of a candidate. `probe` answers true, false, or a
 *  string (the reason the candidate was not usable). */
export const KINDS = {
  CLANMATE: {
    what: "a POAP KINGS member other than the owner with a recorded battle in the last 30 days",
    probe: async (_ctx, member, now) =>
      Boolean(member.last_recorded_battle) &&
      now - Date.parse(member.last_recorded_battle) <= 30 * DAY_MS,
  },
  COLLECTION: {
    what: "a POAP KINGS member other than the owner whose players_collection answers inside the result cap",
    // Bounded: a collection read each, at most this many members tried.
    limit: 8,
    probe: async (ctx, member) => {
      const r = await ctx.read("players_collection", {
        player_tag: member.player_tag,
      });
      return !r.isError && Array.isArray(r.body?.cards);
    },
  },
};

/** Every placeholder string anywhere in a value. */
export function placeholdersIn(value, out = new Set()) {
  if (typeof value === "string") {
    if (PLACEHOLDER.test(value)) out.add(value);
  } else if (Array.isArray(value))
    for (const v of value) placeholdersIn(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) placeholdersIn(v, out);
  return out;
}

/** The value with each placeholder replaced from `map`. */
export function substitute(value, map) {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => substitute(v, map));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, map)]),
    );
  return value;
}

/** A tag as the run may print it: its first two characters. */
export function mask(tag) {
  const bare = String(tag).replace(/^#/, "");
  return `#${bare.slice(0, 2)}${"*".repeat(Math.max(0, bare.length - 2))}`;
}

/** Text with every resolved tag replaced by its placeholder, so a
 *  failure message that echoes a tag stays fit to paste. */
export function redact(text, map) {
  let out = String(text);
  for (const [name, tag] of map)
    out = out.split(tag).join(name).split(tag.slice(1)).join(name);
  return out;
}

/** The roster's members as candidates: sorted by tag, owner left out. */
async function candidates(ctx) {
  ctx.subjects.roster ??= (async () => {
    const r = await ctx.read("clans_roster", { clan_tag: CLAN });
    if (r.isError || !Array.isArray(r.body?.members))
      return { reason: `clans_roster ${CLAN} did not answer with members` };
    return {
      members: r.body.members
        .filter((m) => typeof m.player_tag === "string")
        .filter((m) => m.player_tag !== JAMIE)
        .sort((a, b) => a.player_tag.localeCompare(b.player_tag)),
    };
  })();
  return ctx.subjects.roster;
}

/** Resolve one placeholder (cached for the run): `{ tag }` or
 *  `{ reason }`. Kinds draw from disjoint picks, so `$CLANMATE_1` and
 *  `$CLANMATE_2` are two different players. */
export async function resolvePlaceholder(ctx, name, now = Date.now()) {
  ctx.subjects ??= { resolved: new Map(), pending: new Map() };
  if (!ctx.subjects.pending.has(name))
    ctx.subjects.pending.set(
      name,
      (async () => {
        const m = PLACEHOLDER.exec(name);
        const kind = m && KINDS[m[1]];
        if (!kind) return { reason: `${name}: no such placeholder kind` };
        const n = Number(m[2]);
        const pool = await candidates(ctx);
        if (pool.reason) return { reason: `${name}: ${pool.reason}` };
        const found = [];
        let tried = 0;
        for (const member of pool.members) {
          if (found.length === n) break;
          if (kind.limit && tried >= kind.limit) break;
          tried += 1;
          if ((await kind.probe(ctx, member, now)) === true)
            found.push(member.player_tag);
        }
        if (found.length < n)
          return {
            reason: `${name}: needs ${kind.what}; ${found.length} of ${n} found among ${tried} tried`,
          };
        const tag = found[n - 1];
        ctx.subjects.resolved.set(name, tag);
        return { tag };
      })(),
    );
  return ctx.subjects.pending.get(name);
}

/** A set's arguments with its placeholders resolved: `{ args }`, or
 *  `{ skip }` naming the one that could not be. Arguments with no
 *  placeholder come back as they are and read nothing. */
export async function resolveArgs(ctx, args) {
  const names = [...placeholdersIn(args)];
  if (names.length === 0) return { args };
  const map = new Map();
  for (const name of names) {
    const r = await resolvePlaceholder(ctx, name);
    if (r.reason) return { skip: r.reason };
    map.set(name, r.tag);
  }
  return { args: substitute(args, map) };
}

/** What the run resolved, printed masked, and kept in full only in the
 *  local log. Returns the printable lines. */
export function reportSubjects(ctx, { file = SUBJECTS_LOG } = {}) {
  const resolved = ctx.subjects?.resolved ?? new Map();
  if (resolved.size === 0) return [];
  const sorted = [...resolved].sort(([a], [b]) => a.localeCompare(b));
  try {
    writeFileSync(
      file,
      `${new Date().toISOString()}\n${sorted.map(([n, t]) => `${n} ${t}`).join("\n")}\n`,
      { mode: 0o600 },
    );
  } catch {
    // the masked line below still says what was read
  }
  return sorted.map(([n, t]) => `${n} = ${mask(t)}`);
}
