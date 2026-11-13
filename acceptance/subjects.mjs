/**
 * The players and clans the suite reads but may not name. Many players
 * are minors, and this repo is public: no real player's tag goes in a
 * committed file except the owner's and the clan's (lib.mjs JAMIE and
 * CLAN). Acceptance needs recorded players, so it cannot invent them
 * either; a catalogue set or a gym block names a placeholder instead
 * (`$CLANMATE_1`), and the run resolves it from what its own credential
 * can read.
 *
 * Two sources:
 * - a kind (`KINDS`): the Nth candidate that meets the kind's need, from
 *   the POAP KINGS roster (`$CLANMATE_n`, `$COLLECTION_n`) or from the
 *   players the account follows (`$FRIEND_n`, `$OTHERCLAN_n`). Candidates
 *   are sorted by tag, the owner left out, so the pick is deterministic
 *   for the record of the day.
 * - a pick (`picks.json`): one read of closed data and the path of the
 *   tag in its answer (`$RIVAL_3` is the second row of a closed war
 *   week's standings). Closed data does not move, so a frozen case keeps
 *   reading the same subject it was filed against.
 *
 * `$NAME_n.name` is that subject's current name (players_names), for a
 * case that checks a player is named in a text. A placeholder that
 * cannot be resolved makes its case SKIP with the reason, never fail.
 * The resolved values are never printed in full: the run prints tags
 * masked and names as their length, and writes them to
 * acceptance/subjects.log (ignored by git, mode 0600), the only place
 * they are kept. A replay (bites.test) seeds the resolution from the
 * bite's manifest entry instead of reading.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAN, JAMIE } from "./lib.mjs";
import { resolve } from "./gym-interp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SUBJECTS_LOG = path.join(here, "subjects.log");

/** `$KIND_N`, or `$KIND_N.name`: the Nth subject of a kind, 1-based. */
export const PLACEHOLDER = /^\$([A-Z]+)_([1-9][0-9]*)(\.name)?$/;
/** The same, anywhere in a string (a path filter, a notes pattern). */
const EMBEDDED = /\$([A-Z]+)_([1-9][0-9]*)(\.name)?(?![0-9A-Za-z_])/g;

/** Frozen picks: `{ "$RIVAL_1": { what, tool, args, pick } }`. */
export const PICKS = JSON.parse(
  readFileSync(path.join(here, "picks.json"), "utf8"),
);

const DAY_MS = 86_400_000;

/** The candidates a kind draws from, read once per run. */
const SOURCES = {
  /** The roster's members: sorted by tag, owner left out. */
  roster: async (ctx) => {
    const r = await ctx.read("clans_roster", { clan_tag: CLAN });
    if (r.isError || !Array.isArray(r.body?.members))
      return { reason: `clans_roster ${CLAN} did not answer with members` };
    return {
      members: r.body.members
        .filter((m) => typeof m.player_tag === "string")
        .filter((m) => m.player_tag !== JAMIE)
        .sort((a, b) => a.player_tag.localeCompare(b.player_tag)),
    };
  },
  /** The players the account follows that are not POAP KINGS members. */
  following: async (ctx) => {
    const r = await ctx.read("elixir_my_players", {});
    if (r.isError || !Array.isArray(r.body?.players))
      return { reason: "elixir_my_players did not answer with players" };
    return {
      members: r.body.players
        .filter((p) => typeof p.player_tag === "string")
        .filter((p) => p.player_tag !== JAMIE && p.clan_tag !== CLAN)
        .sort((a, b) => a.player_tag.localeCompare(b.player_tag)),
    };
  },
  /** The clans the followed players are in, POAP KINGS left out. */
  otherClans: async (ctx) => {
    const r = await ctx.read("elixir_my_players", {});
    if (r.isError || !Array.isArray(r.body?.players))
      return { reason: "elixir_my_players did not answer with players" };
    const tags = new Set(
      r.body.players
        .map((p) => p.clan_tag)
        .filter((t) => typeof t === "string" && t !== CLAN),
    );
    return {
      members: [...tags].sort().map((clan_tag) => ({ clan_tag })),
    };
  },
};

/** What each kind needs of a candidate. `probe` answers true, false, or a
 *  string (the reason the candidate was not usable); `tagOf` reads the
 *  candidate's tag. */
export const KINDS = {
  CLANMATE: {
    source: "roster",
    what: "a POAP KINGS member other than the owner with a recorded battle in the last 30 days",
    probe: async (_ctx, member, now) =>
      Boolean(member.last_recorded_battle) &&
      now - Date.parse(member.last_recorded_battle) <= 30 * DAY_MS,
  },
  COLLECTION: {
    source: "roster",
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
  FRIEND: {
    source: "following",
    what: "a player the account follows, outside POAP KINGS, that is being recorded",
    probe: async (_ctx, player) => player.recording === "active",
  },
  OTHERCLAN: {
    source: "otherClans",
    what: "the clan of a followed player, other than POAP KINGS, whose roster is recorded",
    tagOf: (c) => c.clan_tag,
    // Bounded: a roster read each.
    limit: 6,
    probe: async (ctx, clan) => {
      const r = await ctx.read("clans_roster", { clan_tag: clan.clan_tag });
      return !r.isError && Array.isArray(r.body?.members);
    },
  },
};

/** Every placeholder anywhere in a value, whole strings or embedded. */
export function placeholdersIn(value, out = new Set()) {
  if (typeof value === "string") {
    for (const m of value.matchAll(EMBEDDED)) out.add(m[0]);
  } else if (Array.isArray(value))
    for (const v of value) placeholdersIn(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) placeholdersIn(v, out);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The value with each placeholder replaced from `map`, wherever it
 *  stands in a string. With `regex`, a replacement is escaped (a name in
 *  a notes pattern matches as written). */
export function substitute(value, map, { regex = false } = {}) {
  if (typeof value === "string")
    return value.replace(EMBEDDED, (m) =>
      map.has(m) ? (regex ? escapeRe(map.get(m)) : map.get(m)) : m,
    );
  if (Array.isArray(value))
    return value.map((v) => substitute(v, map, { regex }));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, map, { regex })]),
    );
  return value;
}

/** A tag as the run may print it: its first two characters. */
export function mask(tag) {
  const bare = String(tag).replace(/^#/, "");
  return `#${bare.slice(0, 2)}${"*".repeat(Math.max(0, bare.length - 2))}`;
}

/** Text with every resolved value replaced by its placeholder, so a
 *  failure message that echoes one stays fit to paste. */
export function redact(text, map) {
  let out = String(text);
  // Longest first, so a name that contains another is taken whole.
  const pairs = [...map].sort(([, a], [, b]) => b.length - a.length);
  for (const [name, value] of pairs) {
    if (!value) continue;
    out = out.split(value).join(name);
    if (value.startsWith("#")) out = out.split(value.slice(1)).join(name);
  }
  return out;
}

function state(ctx) {
  ctx.subjects ??= { resolved: new Map(), pending: new Map(), sources: {} };
  ctx.subjects.sources ??= {};
  return ctx.subjects;
}

/** Seed the resolution (a replay: the bite's manifest says what each
 *  placeholder stood for on the captured day). */
export function seedSubjects(ctx, map = {}) {
  const s = state(ctx);
  for (const [name, value] of Object.entries(map)) {
    s.resolved.set(name, value);
    s.pending.set(name, Promise.resolve({ tag: value }));
  }
}

async function resolvePick(ctx, name, spec) {
  const r = await ctx.read(spec.tool, spec.args ?? {});
  if (r.isError)
    return { reason: `${name}: ${spec.tool} did not answer (${spec.what})` };
  let value;
  try {
    value = resolve(r.body, spec.pick);
  } catch {
    value = undefined;
  }
  if (typeof value !== "string" || !value.startsWith("#"))
    return { reason: `${name}: ${spec.pick} holds no tag (${spec.what})` };
  return { tag: value };
}

async function resolveKind(ctx, name, kind, n, now) {
  const s = state(ctx);
  s.sources[kind.source] ??= SOURCES[kind.source](ctx);
  const pool = await s.sources[kind.source];
  if (pool.reason) return { reason: `${name}: ${pool.reason}` };
  const tagOf = kind.tagOf ?? ((m) => m.player_tag);
  const found = [];
  let tried = 0;
  for (const member of pool.members) {
    if (found.length === n) break;
    if (kind.limit && tried >= kind.limit) break;
    tried += 1;
    if ((await kind.probe(ctx, member, now)) === true)
      found.push(tagOf(member));
  }
  if (found.length < n)
    return {
      reason: `${name}: needs ${kind.what}; ${found.length} of ${n} found among ${tried} tried`,
    };
  return { tag: found[n - 1] };
}

async function resolveName(ctx, name, base) {
  const t = await resolvePlaceholder(ctx, base);
  if (t.reason) return t;
  const r = await ctx.read("players_names", { player_tags: [t.tag] });
  const row = r.body?.names?.find?.((x) => x.player_tag === t.tag);
  if (r.isError || typeof row?.name !== "string" || row.name === "")
    return { reason: `${name}: players_names has no name for ${base}` };
  return { tag: row.name };
}

/** Resolve one placeholder (cached for the run): `{ tag }` (the value:
 *  a tag, or a name for `.name`) or `{ reason }`. Kinds draw from
 *  disjoint picks, so `$CLANMATE_1` and `$CLANMATE_2` are two different
 *  players. */
export async function resolvePlaceholder(ctx, name, now = Date.now()) {
  const s = state(ctx);
  if (!s.pending.has(name))
    s.pending.set(
      name,
      (async () => {
        const m = PLACEHOLDER.exec(name);
        if (!m) return { reason: `${name}: not a placeholder` };
        const base = `$${m[1]}_${m[2]}`;
        let out;
        if (m[3]) out = await resolveName(ctx, name, base);
        else if (PICKS[name]) out = await resolvePick(ctx, name, PICKS[name]);
        else if (KINDS[m[1]])
          out = await resolveKind(ctx, name, KINDS[m[1]], Number(m[2]), now);
        else out = { reason: `${name}: no such placeholder kind or pick` };
        if (out.tag) s.resolved.set(name, out.tag);
        return out;
      })(),
    );
  return s.pending.get(name);
}

/** Resolve every placeholder in a value: `{ map }`, or `{ skip }` naming
 *  the one that could not be. A value with none reads nothing. */
export async function resolveAll(ctx, value) {
  const map = new Map();
  for (const name of placeholdersIn(value)) {
    const r = await resolvePlaceholder(ctx, name);
    if (r.reason) return { skip: r.reason };
    map.set(name, r.tag);
  }
  return { map };
}

/** A set's arguments with their placeholders resolved: `{ args }`, or
 *  `{ skip }` naming the one that could not be. Arguments with no
 *  placeholder come back as they are and read nothing. */
export async function resolveArgs(ctx, args) {
  const r = await resolveAll(ctx, args);
  if (r.skip) return { skip: r.skip };
  return { args: r.map.size ? substitute(args, r.map) : args };
}

/** What the run resolved, printed masked (a name as its length), and kept
 *  in full only in the local log. Returns the printable lines. */
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
  return sorted.map(([n, t]) =>
    n.endsWith(".name")
      ? `${n} = (${t.length} characters)`
      : `${n} = ${mask(t)}`,
  );
}
