/**
 * The timeline's items, kind by kind: what `at` means and which `facts`
 * keys every item of the kind carries (11.8.0, #373-#376). Each kind is
 * versioned on its own: an item's `schema` is `<kind>/<version>`, and a
 * kind's version moves when its facts or the meaning of its `at` change,
 * so a consumer can branch on the kinds it knows and notice one that
 * moved. The docs' facts table is held to this list by a test
 * (timeline-publication.test.mjs), and every built item is checked against
 * it in the timeline tests.
 *
 * `facts` are the keys always present (a value may be null where the
 * docs say so); `optional` keys appear only when the record holds them.
 */
import { ATTESTED_FACT_TYPES } from "@elixir-mcp/contracts";

const MEMBER = ["player_tag", "name"];
const SITTING = [
  ...MEMBER,
  "started_at",
  "ended_at",
  "duration_s",
  "battles",
  "won",
  "lost",
  "drawn",
  "by_mode",
  "trophy_net",
  "trophy_net_peak",
  "won_in_a_row",
  "open",
  "decks",
  "events",
];
const ROSTER = ["roster_size_before", "roster_size_after"];

export const TIMELINE_KIND_SCHEMAS = {
  battle_session: {
    version: 2,
    at: "the sitting's first battle; sort_at is its last",
    facts: SITTING,
  },
  session_standout: {
    // 3 (2026-10-11): crossings[] name their battle_id; teammate and
    // best_win say how the sitting went.
    version: 3,
    at: "the battle that crossed the newest rung this window learned (every rung's is crossings[].at); sort_at is the sitting's last battle",
    facts: [...SITTING, "crossed", "newly", "crossings"],
    optional: ["teammate", "best_win"],
  },
  badge_earned: {
    version: 2,
    at: "the profile read that saw the level",
    facts: [...MEMBER, "badge", "badge_label"],
    optional: ["level", "max_level", "prior_level"],
  },
  legendary_badge_earned: {
    version: 2,
    at: "the profile read that saw it",
    facts: [...MEMBER, "badge", "badge_label"],
  },
  arena_changed: {
    version: 2,
    at: "the promoting battle when promoted_by is present, else the read that saw the move",
    facts: [...MEMBER, "from", "to", "from_name", "to_name"],
    optional: ["promoted_by"],
  },
  ranked_promotion: {
    version: 2,
    at: "the promoting battle when promoted_by is present, else the read that saw the league",
    facts: [...MEMBER, "from", "to", "from_name", "to_name"],
    optional: ["promoted_by"],
  },
  best_trophies_band: {
    version: 2,
    at: "the crossing battle when crossed_by is present, else the read that saw the best",
    facts: [...MEMBER, "best"],
    optional: ["band", "crossed_by"],
  },
  collection_level_step: {
    version: 2,
    at: "the profile read that saw the level",
    facts: [...MEMBER, "level", "step"],
  },
  career_wins_step: {
    version: 2,
    at: "the crossing win when crossed_by is present, else the read that saw the count",
    facts: [...MEMBER, "wins"],
    optional: ["step", "crossed_by"],
  },
  card_unlocked: {
    version: 2,
    at: "the profile read that saw the card",
    facts: [...MEMBER, "card", "card_id", "rarity"],
  },
  card_form_unlocked: {
    version: 2,
    at: "the profile read that saw the form (it happened no later)",
    facts: [...MEMBER, "card", "card_id", "rarity", "form"],
  },
  clan_joined: {
    version: 2,
    at: "the roster read that saw the join",
    facts: [...MEMBER, "kind", "clan_tag", "clan_name", "at"],
  },
  clan_left: {
    version: 2,
    at: "the roster read that saw the departure",
    facts: [...MEMBER, "kind", "clan_tag", "clan_name", "role", "at"],
  },
  member_joined: {
    version: 1,
    at: "the roster read that saw the join",
    facts: [...MEMBER, "role", ...ROSTER],
  },
  member_left: {
    version: 1,
    at: "the roster read that saw the departure",
    facts: [...MEMBER, "role_at_departure", "joined_observed_at", ...ROSTER],
  },
  member_role_changed: {
    version: 1,
    at: "the roster read that saw the new role",
    facts: [...MEMBER, "role_before", "role_after", "direction", ...ROSTER],
  },
  bracket_observed: {
    version: 1,
    at: "the record's first sight of the week",
    facts: ["season_id", "section_index", "is_colosseum", "rivals"],
  },
  race_finished: {
    version: 1,
    at: "the finish, when the race log gives it, else the read that saw it",
    facts: ["season_id", "section_index", "fame", "finish_time"],
  },
  week_resolved: {
    version: 2,
    at: "the read that saw the week close",
    facts: [
      "season_id",
      "section_index",
      "is_colosseum",
      "fame",
      "rank",
      "trophy_change",
      "members",
    ],
  },
  quiet_crossed: {
    version: 2,
    at: "the last battle plus the rung's days",
    facts: [...MEMBER, "rung", "days_quiet", "days_since_poll"],
    optional: ["role"],
  },
  returned: {
    version: 2,
    at: "the battle that ended the absence",
    facts: [...MEMBER, "after_days"],
  },
  account: {
    version: 2,
    at: "the first event of the burst",
    facts: ["count", "apps"],
  },
  ...Object.fromEntries(
    Object.entries(ATTESTED_FACT_TYPES).map(([kind, t]) => [
      kind,
      {
        // personal_record gained player_tag and name in 11.8.0.
        version: t.subject === "player" ? 2 : 1,
        at: "when it happened, as attested; selected by when Elixir recorded it",
        facts: [
          ...Object.entries(t.detail)
            .filter(([, f]) => !f.optional)
            .map(([k]) => k),
          ...(t.member || t.subject === "player" ? MEMBER : []),
          "attested_by",
          "visibility",
        ],
        optional: Object.entries(t.detail)
          .filter(([, f]) => f.optional)
          .map(([k]) => k),
      },
    ]),
  ),
};

const schemaOf = (kind) =>
  TIMELINE_KIND_SCHEMAS[kind.startsWith("account_") ? "account" : kind];

/** The schema an item's facts follow: `<kind>/<version>`. */
export function itemSchema(kind) {
  const s = schemaOf(kind);
  return s ? `${kind}/${s.version}` : `${kind}/1`;
}

/** The facts keys an item of this kind is missing, for tests. */
export function missingFacts(item) {
  const s = schemaOf(item.kind);
  if (!s) return [`unknown kind ${item.kind}`];
  return s.facts.filter((k) => !(k in (item.facts ?? {})));
}
