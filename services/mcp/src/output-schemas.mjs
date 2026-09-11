/**
 * Output schemas for the most-called tools (1.0.0, review Part 3.2).
 *
 * Responses were JSON inside a text block, visible to the model and to
 * nothing else: /docs/tools documented inputs only, and every response
 * field was learned by calling. A declared outputSchema does three things
 * at once: it appears in tools/list beside inputSchema, the docs generator
 * renders "what comes back" from it, and the registry validates the body
 * against it (throwing under the test runner, logging in production) so
 * the declaration cannot drift from the handler.
 *
 * Schemas are deliberately permissive below the top level: required keys
 * and types for the fields a caller branches on, `additionalProperties`
 * left open elsewhere so an additive field is a minor, not a mismatch.
 * Ten tools to start - the ones the call log ranks first; the rest follow
 * as they are touched.
 */

const ISO = { type: "string", description: "ISO 8601 UTC instant." };
const DATE = { type: "string", description: "YYYY-MM-DD." };
const TAG = {
  type: "string",
  description: "Clash Royale tag, e.g. #20JJJ2CCRU.",
};
const RATE = {
  type: ["number", "null"],
  description: "0..1, three decimals; null when the denominator is zero.",
};
const COUNT = { type: "integer" };

const WINDOW_ECHO = {
  type: "object",
  description: "The window that applied and where it came from.",
  properties: {
    from: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
    source: {
      type: "string",
      enum: ["argument", "default", "unbounded", "fixed"],
    },
    timezone: { type: "string" },
    days: COUNT,
  },
  required: ["source"],
};

const NOTES = {
  type: "array",
  items: { type: "string" },
  description: "One-sentence caveats to repeat when quoting the numbers.",
};
const DOCS = {
  type: "string",
  description: "page or page#section for elixir_docs / elixir://docs.",
};

const META = {
  type: "object",
  description: "The envelope (docs: responses).",
  properties: {
    as_of: ISO,
    recorded_since: ISO,
    recording_active_since: ISO,
    freshness_seconds: { type: ["integer", "null"] },
    source_polls: { type: "object" },
    completeness_note: { type: "string" },
    timezone_applied: { type: "string" },
    feedback_responses_pending: COUNT,
    events_pending: COUNT,
    quota: { type: "object" },
    request_id: { type: "string" },
    disclaimer: { type: "string" },
    contract_version: { type: "string" },
  },
  required: ["as_of", "disclaimer", "contract_version"],
};

const DECK_CARD = {
  type: "object",
  properties: {
    id: COUNT,
    name: { type: "string" },
    evolution: {
      type: "integer",
      description: "1 = Evolution, 2 = Hero form.",
    },
  },
  required: ["id", "name"],
};

const RECORD = {
  battles: COUNT,
  wins: COUNT,
  losses: COUNT,
  draws: COUNT,
  win_rate: RATE,
};

const PERF_WINDOW = {
  type: "object",
  properties: {
    ...RECORD,
    boat_battles: COUNT,
    duel_battles: COUNT,
    crowns_for: COUNT,
    crowns_against: COUNT,
    net_trophies: COUNT,
    current_streak: COUNT,
    decided_battles: COUNT,
    decided_wins: COUNT,
    decided_losses: COUNT,
    head_to_head_battles: COUNT,
    three_crown_rate: RATE,
  },
  required: ["battles", "wins", "losses", "decided_battles", "win_rate"],
};

const PARTICIPANT = {
  type: "object",
  properties: {
    player_tag: TAG,
    name: { type: ["string", "null"] },
    name_known: { type: "boolean" },
    crowns: { type: ["integer", "null"] },
    deck_hash: { type: ["string", "null"] },
    clan_tag: { type: ["string", "null"] },
    rounds_played: COUNT,
    deck: { type: ["object", "null"] },
    tower_hp: { type: ["object", "null"] },
  },
  required: ["player_tag", "name_known"],
};

export const OUTPUT_SCHEMAS = {
  players_summary: {
    type: "object",
    properties: {
      player_tag: TAG,
      name: { type: ["string", "null"] },
      nickname: { type: "string" },
      clan: {
        type: ["object", "null"],
        properties: { clan_tag: TAG, name: { type: ["string", "null"] } },
      },
      trophies: { type: ["integer", "null"] },
      trophies_as_of: {
        type: ["string", "null"],
        description: "YYYY-MM-DD of the snapshot.",
      },
      applied: { type: "object", properties: { window: WINDOW_ECHO } },
      last_30_days: {
        type: "object",
        properties: {
          ...RECORD,
          net_trophies: COUNT,
          first_recorded: { type: ["string", "null"] },
        },
        required: ["battles", "wins", "losses", "win_rate"],
      },
      top_deck: {
        type: ["object", "null"],
        properties: {
          deck_hash: { type: "string" },
          cards: { type: "array", items: DECK_CARD },
          battles: COUNT,
          win_rate: RATE,
        },
      },
      best_deck: { type: ["object", "null"] },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "player_tag",
      "last_30_days",
      "top_deck",
      "notes",
      "docs",
      "meta",
    ],
  },

  players_profile: {
    type: "object",
    properties: {
      player_tag: TAG,
      name: { type: ["string", "null"] },
      applied: { type: "object" },
      clan: { type: ["object", "null"] },
      last_seen_in_game: {
        type: ["string", "null"],
        description: "The game's own lastSeen.",
      },
      attributes: {
        type: "object",
        properties: {
          arena_id: { type: ["integer", "null"] },
          best_trophies: { type: ["integer", "null"] },
          favorite_card_id: { type: ["integer", "null"] },
          years_played: { type: ["integer", "null"] },
          account_age_days: { type: ["integer", "null"] },
        },
      },
      badges: { type: "array" },
      snapshot: {
        type: "object",
        properties: {
          date: DATE,
          trophies: { type: ["integer", "null"] },
          path_of_legend: { type: ["object", "null"] },
          league_statistics: { type: ["object", "null"] },
          donations_this_week: { type: ["integer", "null"] },
          donations_received_this_week: { type: ["integer", "null"] },
          lifetime: { type: ["object", "null"] },
        },
        required: ["date"],
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["player_tag", "attributes", "snapshot", "notes", "docs", "meta"],
  },

  battles_performance: {
    type: "object",
    properties: {
      player_tag: TAG,
      applied: {
        type: "object",
        properties: {
          window: WINDOW_ECHO,
          mode: { type: "string" },
          group_by: { type: "string" },
        },
        required: ["window"],
      },
      window: PERF_WINDOW,
      compare_window: PERF_WINDOW,
      before: PERF_WINDOW,
      after: PERF_WINDOW,
      split_at: ISO,
      by_mode: { type: "array" },
      weekly: { type: "array" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["player_tag", "applied", "notes", "docs", "meta"],
  },

  battles_query: {
    type: "object",
    properties: {
      player_tag: TAG,
      battle_id: { type: "string" },
      deck_hash: { type: "string" },
      deck_stats: { type: "object" },
      applied: {
        type: "object",
        properties: {
          window: WINDOW_ECHO,
          limit: COUNT,
          verbosity: { type: "string", enum: ["full", "compact"] },
        },
        required: ["window", "limit", "verbosity"],
      },
      battles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            battle_id: { type: "string" },
            battle_time: ISO,
            battle_time_local: {
              type: "string",
              description: "ISO 8601 with offset.",
            },
            type: { type: "string" },
            game_mode: { type: "object" },
            arena: { type: ["string", "null"] },
            league_number: { type: ["integer", "null"] },
            me: { type: "object" },
            teammates: { type: "array", items: PARTICIPANT },
            opponents: { type: "array", items: PARTICIPANT },
          },
          required: ["battle_id", "battle_time", "me", "opponents"],
        },
      },
      total_count: COUNT,
      next_cursor: {
        type: ["string", "null"],
        description: "Opaque; null = end.",
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["applied", "battles", "next_cursor", "notes", "docs", "meta"],
  },

  battles_decks: {
    type: "object",
    properties: {
      player_tag: TAG,
      applied: {
        type: "object",
        properties: { window: WINDOW_ECHO },
        required: ["window"],
      },
      total_battles_in_window: COUNT,
      decks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deck_hash: { type: "string" },
            cards: { type: "array", items: DECK_CARD },
            tower_troop: { type: "object" },
            ...RECORD,
            share_of_battles: RATE,
            first_used: ISO,
            last_used: ISO,
          },
          required: ["deck_hash", "cards", "battles", "win_rate"],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["player_tag", "applied", "decks", "notes", "docs", "meta"],
  },

  war_current: {
    type: "object",
    properties: {
      clan_tag: TAG,
      season_id: COUNT,
      section_index: COUNT,
      is_colosseum: { type: "boolean" },
      day_kind: { type: ["string", "null"] },
      war_day: { type: ["integer", "null"] },
      next_war_day_opens_at: { type: ["string", "null"] },
      applied: { type: "object" },
      standings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            participant_clan_tag: TAG,
            participant_name: { type: ["string", "null"] },
            fame: COUNT,
            period_points: {
              type: ["integer", "null"],
              description:
                "Score in the current war day; null when only finished history was captured.",
            },
            rank: { type: ["integer", "null"] },
            trophy_change: { type: ["integer", "null"] },
            finish_time: { type: ["string", "null"] },
          },
          required: ["participant_clan_tag", "fame", "period_points"],
        },
      },
      participants: { type: "array" },
      participants_count: COUNT,
      member_count: COUNT,
      members_not_in_race: { type: "array" },
      period: { type: "object" },
      decks_today: {
        type: ["object", "null"],
        properties: {
          war_day: COUNT,
          untouched: { type: "array" },
          partial: { type: "array" },
          finished: { type: "array" },
          counts: { type: "object" },
          over_cap: { type: "array" },
        },
      },
      decks_today_reason: {
        type: "string",
        enum: ["period_unknown", "war_day_over", "training_day"],
      },
      attendance_by_war_day: { type: "array" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "clan_tag",
      "season_id",
      "section_index",
      "day_kind",
      "war_day",
      "standings",
      "participants_count",
      "member_count",
      "members_not_in_race",
      "decks_today",
      "notes",
      "docs",
      "meta",
    ],
  },

  clans_roster: {
    type: "object",
    properties: {
      clan_tag: TAG,
      applied: { type: "object" },
      name: { type: ["string", "null"] },
      member_count: COUNT,
      role_counts: { type: "object" },
      members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player_tag: TAG,
            name: { type: ["string", "null"] },
            nickname: { type: "string" },
            role: { type: "string" },
            trophies: { type: ["integer", "null"] },
            donations_this_week: { type: ["integer", "null"] },
            first_observed_in_clan: { type: ["string", "null"] },
            last_recorded_battle: { type: ["string", "null"] },
            last_seen_in_game: { type: ["string", "null"] },
          },
          required: ["player_tag", "role"],
        },
      },
      events_recorded_since: { type: ["string", "null"] },
      recent_events: { type: "array" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["clan_tag", "applied", "name", "member_count", "meta"],
  },

  clans_standings: {
    type: "object",
    properties: {
      clan_tag: TAG,
      applied: {
        type: "object",
        properties: { window: WINDOW_ECHO },
        required: ["window"],
      },
      ranked_members: COUNT,
      median_win_rate: RATE,
      members: { type: "array" },
      below_floor: { type: "array" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "clan_tag",
      "applied",
      "ranked_members",
      "median_win_rate",
      "members",
      "below_floor",
      "notes",
      "docs",
      "meta",
    ],
  },

  elixir_events: {
    type: "object",
    properties: {
      applied: { type: "object" },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            event_id: COUNT,
            topic: { type: "string" },
            subject_tag: { type: "string" },
            payload: { type: "object" },
            created_at: ISO,
          },
          required: ["event_id", "topic", "created_at"],
        },
      },
      next_cursor: COUNT,
      seen_through: COUNT,
      has_more: { type: "boolean" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "applied",
      "events",
      "next_cursor",
      "seen_through",
      "has_more",
      "notes",
      "docs",
      "meta",
    ],
  },

  elixir_coverage: {
    type: "object",
    properties: {
      player_tag: TAG,
      polls: { type: "array" },
      battles: {
        type: "object",
        properties: {
          recorded_appearances: COUNT,
          first_recorded: { type: ["string", "null"] },
          last_recorded: { type: ["string", "null"] },
        },
        required: ["recorded_appearances"],
      },
      snapshots: {
        type: "object",
        properties: { first_date: { type: ["string", "null"] } },
      },
      observation_intervals: { type: "array" },
      completeness_last_7_days: {
        type: "object",
        description:
          "Measured intervals plus the explicit unmeasured tail after the latest profile snapshot.",
        properties: {
          average_ratio: { type: ["string", "null"] },
          incomplete_days: { type: "null" },
          incomplete_intervals: { type: ["integer", "null"] },
          measured_intervals: COUNT,
          measured_span: { type: ["object", "null"] },
          measured_hours: { type: ["number", "null"] },
          unmeasured_tail_hours: {
            type: ["number", "null"],
            description:
              "Hours since the latest profile snapshot; not included in average_ratio.",
          },
          unknown_intervals: COUNT,
        },
        required: [
          "average_ratio",
          "incomplete_days",
          "incomplete_intervals",
          "measured_intervals",
          "measured_span",
          "measured_hours",
          "unmeasured_tail_hours",
          "unknown_intervals",
        ],
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "player_tag",
      "polls",
      "battles",
      "snapshots",
      "notes",
      "docs",
      "meta",
    ],
  },
};
