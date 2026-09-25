/**
 * Payload evidence: what the archive shows about each field path of an
 * endpoint, as aggregates only. It feeds the reference audit
 * (.claude/skills/reference-audit), which diffs it against
 * cr-agent-api-docs; `infra/scripts/payload-field-audit.mjs --json` is
 * the reader that walks the S3 archive through it.
 *
 * Paths follow the manifest's grammar (payload-keys.mjs): dots for keys,
 * `[]` for an array's elements, `*` for a map's keys. Unlike payloadPaths,
 * which yields leaf paths only, this records containers too, so the
 * reference's absent / null / empty claims can be checked: a child path's
 * absences are its parent's `seen` minus its own.
 *
 * Privacy: the reference is PUBLIC and takes no player or clan tags or
 * names. Values are collected only for the paths in EVIDENCE_ENUMS, which
 * a test keeps free of identity fields; everything else is counts, JSON
 * types and archive dates.
 */

import { PAYLOAD_KEYS } from "./payload-keys.mjs";

/** The paths whose VALUES are game vocabulary worth enumerating: battle
 *  types, mode ids, roles, rarities, badge and achievement names, map
 *  keys. Never a tag, a player or clan name, or free text. A `*` path
 *  collects a map's keys (`progress.*`: the progress buckets). */
export const EVIDENCE_ENUMS = {
  player: [
    "role",
    "arena.id",
    "arena.rawName",
    "badges[].name",
    "badges[].maxLevel",
    "achievements[].name",
    "cards[].rarity",
    "cards[].maxLevel",
    "cards[].maxEvolutionLevel",
    "cards[].evolutionLevel",
    "supportCards[].rarity",
    "currentPathOfLegendSeasonResult.leagueNumber",
    "lastPathOfLegendSeasonResult.leagueNumber",
    "bestPathOfLegendSeasonResult.leagueNumber",
    "progress.*",
    "progress.*.arena.rawName",
  ],
  player_battlelog: [
    "[].type",
    "[].gameMode.id",
    "[].gameMode.name",
    "[].deckSelection",
    "[].arena.id",
    "[].arena.rawName",
    "[].leagueNumber",
    "[].eventTag",
    "[].isLadderTournament",
    "[].isHostedMatch",
    "[].boatBattleSide",
    "[].boatBattleWon",
    "[].modifiers[].tag",
    "[].modifiers[].modifiers[]",
    "[].team[].cards[].evolutionLevel",
    "[].team[].cards[].rarity",
    "[].team[].supportCards[].rarity",
  ],
  clan: [
    "type",
    "clanChestStatus",
    "memberList[].role",
    "memberList[].arena.rawName",
  ],
  currentriverrace: ["state", "periodType", "periodLogs[].periodIndex"],
  cards: [
    "items[].rarity",
    "items[].maxLevel",
    "items[].maxEvolutionLevel",
    "supportItems[].rarity",
    "supportItems[].maxLevel",
  ],
  leaderboards: ["items[].name"],
  events: ["[].eventTag", "[].title"],
  globaltournaments: [
    "items[].gameMode.id",
    "items[].gameMode.name",
    "items[].milestoneRewards[].type",
    "items[].freeTierRewards[].type",
    "items[].freeTierRewards[].resource",
    "items[].freeTierRewards[].rarity",
    "items[].topRankReward[].type",
  ],
};

/** `endpoint:path` name and tag paths that are game content (a badge, an
 *  achievement, a mode, a leaderboard, a modifier), not a person or a
 *  clan. Qualified by endpoint because `items[].name` is a leaderboard's
 *  name on one and a player's on another. The privacy test refuses any
 *  other `name` or `tag` path in EVIDENCE_ENUMS. */
export const GAME_CONTENT_NAME_PATHS = new Set([
  "player:badges[].name",
  "player:achievements[].name",
  "player_battlelog:[].gameMode.name",
  "player_battlelog:[].modifiers[].tag",
  "globaltournaments:items[].gameMode.name",
  "leaderboards:items[].name",
]);

const MAPS = ["progress"];
const MAX_VALUES = 500;

const jsonType = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
};

const earlier = (a, b) => (a === null || (b !== null && b < a) ? b : a);
const later = (a, b) => (a === null || (b !== null && b > a) ? b : a);

/** An accumulator for one endpoint: add(payload, dt, entity) per archived
 *  object (dt is the archive partition's YYYY-MM-DD, entity its entity
 *  key), then toJSON(). Entities are counted per path, never listed. */
export function createEvidence(endpoint) {
  const enumPaths = new Set(EVIDENCE_ENUMS[endpoint] ?? []);
  const paths = new Map();
  const values = new Map();
  const truncated = new Set();
  const entitiesOf = new Map();
  const allEntities = new Set();
  let objects = 0;
  let firstDt = null;
  let lastDt = null;

  const value = (path, v, dt) => {
    let byValue = values.get(path);
    if (!byValue) values.set(path, (byValue = new Map()));
    const key = String(v);
    let row = byValue.get(key);
    if (!row) {
      if (byValue.size >= MAX_VALUES) {
        truncated.add(path);
        return;
      }
      byValue.set(key, (row = { count: 0, first_dt: null, last_dt: null }));
    }
    row.count += 1;
    row.first_dt = earlier(row.first_dt, dt);
    row.last_dt = later(row.last_dt, dt);
  };

  function add(payload, dt = null, entity = null) {
    objects += 1;
    if (entity !== null) allEntities.add(entity);
    firstDt = earlier(firstDt, dt);
    lastDt = later(lastDt, dt);
    const inThisObject = new Set();
    const record = (path, v) => {
      let p = paths.get(path);
      if (!p) {
        p = {
          seen: 0,
          objects: 0,
          types: {},
          empty: 0,
          first_dt: null,
          last_dt: null,
        };
        paths.set(path, p);
      }
      p.seen += 1;
      const t = jsonType(v);
      p.types[t] = (p.types[t] ?? 0) + 1;
      if (t === "array" && v.length === 0) p.empty += 1;
      if (!inThisObject.has(path)) {
        inThisObject.add(path);
        p.objects += 1;
        if (entity !== null) {
          let set = entitiesOf.get(path);
          if (!set) entitiesOf.set(path, (set = new Set()));
          set.add(entity);
        }
        p.first_dt = earlier(p.first_dt, dt);
        p.last_dt = later(p.last_dt, dt);
      }
      if (enumPaths.has(path) && t !== "object" && t !== "array")
        value(path, v, dt);
    };
    const walk = (v, path) => {
      if (path) record(path, v);
      if (Array.isArray(v)) {
        for (const el of v) walk(el, `${path}[]`);
        return;
      }
      if (v && typeof v === "object") {
        const isMap = MAPS.includes(path.split(".").pop());
        for (const k of Object.keys(v)) {
          const child = path ? `${path}.${isMap ? "*" : k}` : k;
          if (isMap && enumPaths.has(child)) value(child, k, dt);
          walk(v[k], child);
        }
      }
    };
    walk(payload, "");
  }

  function toJSON(meta = {}) {
    const manifest = PAYLOAD_KEYS[endpoint] ?? {};
    const disposition = (path) => {
      const d = manifest[path];
      if (!d) return null;
      if (d.dropped) return "dropped";
      if (d.derived) return "derived";
      return "stored";
    };
    const out = [...paths.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, p]) => ({
        path,
        ...p,
        entities: entitiesOf.get(path)?.size ?? 0,
        // Containers carry no manifest entry by design (it lists leaves);
        // a leaf with none is a field nobody has decided about.
        disposition:
          disposition(path) ??
          (p.types.object || p.types.array ? "container" : "UNCATALOGUED"),
        optional: Boolean(manifest[path]?.optional),
      }));
    const enums = {};
    for (const [path, byValue] of [...values].sort(([a], [b]) =>
      a < b ? -1 : 1,
    ))
      enums[path] = {
        truncated: truncated.has(path),
        values: [...byValue]
          .map(([v, row]) => ({ value: v, ...row }))
          .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)),
      };
    return {
      endpoint,
      ...meta,
      objects,
      entities: allEntities.size,
      dt_range: { first: firstDt, last: lastDt },
      paths: out,
      enums,
      manifest_never_observed: Object.keys(manifest)
        .filter((p) => !paths.has(p))
        .sort(),
    };
  }

  return { add, toJSON };
}
