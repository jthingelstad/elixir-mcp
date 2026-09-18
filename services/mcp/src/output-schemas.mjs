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
const NULLABLE_INT = { type: ["integer", "null"] };
/** A Path of Legends season result as the API carries it; null when the
 *  player has none. */
const POL_RESULT = {
  type: ["object", "null"],
  properties: {
    leagueNumber: NULLABLE_INT,
    trophies: NULLABLE_INT,
    rank: NULLABLE_INT,
  },
};

const WINDOW_ECHO = {
  type: "object",
  description: "The window that applied and where it came from.",
  properties: {
    from: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
    source: {
      type: "string",
      enum: ["argument", "default", "unbounded", "fixed", "season"],
    },
    timezone: { type: "string" },
    days: COUNT,
    // The season-grained tools (3.10.0): which season the window starts
    // in, every roll inside it, and the season's age at the window's end.
    season: {
      type: ["object", "null"],
      properties: {
        month: { type: "string" },
        war: COUNT,
        starts_at: { type: "string" },
        ends_at: { type: "string" },
      },
    },
    crosses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["season"] },
          at: { type: "string" },
          from_season: { type: ["object", "null"] },
          to_season: { type: "object" },
        },
        required: ["kind", "at", "to_season"],
      },
    },
    season_age_days: COUNT,
  },
  required: ["source"],
};

/** A point of a member's daily series: the day, the stamps that
 *  produced the row (null means that writer never touched it), and the
 *  metrics asked for. */
const SERIES_POINT = {
  type: "object",
  properties: {
    date: DATE,
    day: DATE,
    iso_week: { type: "string" },
    kind: { type: "string", enum: ["daily", "pre_reset", "season_roll"] },
    observed_at: { type: ["string", "null"] },
    profile_observed_at: {
      type: ["string", "null"],
      description:
        "The profile poll that wrote the lifetime block; null on a roster-only day.",
    },
    roster_observed_at: {
      type: ["string", "null"],
      description:
        "The roster poll that wrote the clan columns; null when the roster never touched the row.",
    },
    source: { type: "string", enum: ["api", "elixir-bot"] },
    clan_tag: { type: ["string", "null"] },
  },
  required: ["kind", "source"],
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
    timeline_pending: COUNT,
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
    elixir_leaked: {
      type: ["number", "null"],
      description:
        "This side's own leaked-elixir counter (3.13.0); null when the game did not report it. Full verbosity only.",
    },
    tower_hp: { type: ["object", "null"] },
  },
  required: ["player_tag", "name_known"],
};

/** Battles by mode group: { ladder: {battles, wins, losses}, war: ... }. */
const MODE_SPLIT = {
  type: "object",
  description:
    "The row's battles by mode group (ladder, ranked, war, casual, challenge, tournament, other), each with battles, wins and losses.",
  additionalProperties: {
    type: "object",
    properties: { battles: COUNT, wins: COUNT, losses: COUNT },
  },
};
const LEVEL_GAP = {
  type: ["number", "null"],
  description:
    "Mean of this side's deck-average card level minus the opposing side's, two decimals; positive = outlevelled them. null when no battle had both levels.",
};

/** The Trophy Road floor a player stood on in a window (3.13.0). */
const TROPHY_FLOOR = {
  type: "object",
  description:
    "The Trophy Road floor the player stood on in the window (3.13.0): present when the window holds ladder battles and the arena's floor is known. floored is true when a loss touched it, and then net_trophies counts wins in full and those losses at zero.",
  properties: {
    floor: COUNT,
    arena: {
      type: ["object", "null"],
      properties: { id: NULLABLE_INT, name: { type: "string" } },
    },
    source: {
      type: "string",
      enum: ["losses_on_floor", "arena_snapshots"],
    },
    floored: { type: "boolean" },
    on_floor_losses: COUNT,
    losses_landing_on_floor: COUNT,
    ladder_battles: COUNT,
    trophy_range: {
      type: "object",
      properties: { lowest: COUNT, highest: COUNT },
    },
  },
  required: ["floor", "floored", "on_floor_losses"],
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
          modes: MODE_SPLIT,
        },
        required: ["battles", "wins", "losses", "win_rate", "modes"],
      },
      trophy_floor: TROPHY_FLOOR,
      top_deck: {
        type: ["object", "null"],
        properties: {
          deck_hash: { type: "string" },
          cards: { type: "array", items: DECK_CARD },
          battles: COUNT,
          win_rate: RATE,
          modes: MODE_SPLIT,
          dominant_mode: {
            type: ["object", "null"],
            properties: { mode: { type: "string" }, share: RATE },
          },
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
          war_day_wins: NULLABLE_INT,
          clan_cards_collected: NULLABLE_INT,
          legacy_trophy_road_high_score: NULLABLE_INT,
        },
      },
      badges: { type: "array" },
      snapshot: {
        type: "object",
        properties: {
          date: DATE,
          trophies: { type: ["integer", "null"] },
          // The three objects render from typed columns (0123): every
          // key is present, null where the API's own object omitted it
          // (a pre-3.0.0 profile lacks starPoints; a player who never
          // ranked has no current result).
          path_of_legend: {
            type: "object",
            properties: {
              current: POL_RESULT,
              best: POL_RESULT,
              seasons: {
                type: "array",
                description:
                  "The last twelve season finals the record kept, newest first (3.15.0).",
                items: {
                  type: "object",
                  properties: {
                    season_month: { type: "string" },
                    league: NULLABLE_INT,
                    trophies: NULLABLE_INT,
                    rank: NULLABLE_INT,
                  },
                  required: ["season_month"],
                },
              },
            },
            required: ["current", "best"],
          },
          league_statistics: {
            type: ["object", "null"],
            properties: {
              currentSeason: {
                type: ["object", "null"],
                properties: {
                  trophies: NULLABLE_INT,
                  bestTrophies: NULLABLE_INT,
                },
              },
              previousSeason: {
                type: ["object", "null"],
                properties: {
                  id: { type: ["string", "null"] },
                  rank: NULLABLE_INT,
                  trophies: NULLABLE_INT,
                  bestTrophies: NULLABLE_INT,
                },
              },
              bestSeason: {
                type: ["object", "null"],
                properties: {
                  id: { type: ["string", "null"] },
                  trophies: NULLABLE_INT,
                  rank: NULLABLE_INT,
                },
              },
            },
          },
          donations_this_week: { type: ["integer", "null"] },
          donations_received_this_week: { type: ["integer", "null"] },
          lifetime: {
            type: ["object", "null"],
            description:
              "Both spellings until 4.0.0: the snake_case keys are the ones clans_roster and players_timeline speak and the ones that stay; the camelCase keys are retired at the major.",
            properties: {
              battleCount: NULLABLE_INT,
              wins: NULLABLE_INT,
              losses: NULLABLE_INT,
              threeCrownWins: NULLABLE_INT,
              starPoints: NULLABLE_INT,
              expPoints: NULLABLE_INT,
              collectionLevel: NULLABLE_INT,
              battle_count: NULLABLE_INT,
              three_crown_wins: NULLABLE_INT,
              star_points: NULLABLE_INT,
              exp_points: NULLABLE_INT,
              collection_level: NULLABLE_INT,
            },
          },
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
      weekly: {
        type: "array",
        items: {
          type: "object",
          properties: {
            iso_week: { type: "string" },
            week_of: { type: "string" },
            ...RECORD,
            trophy_battles: COUNT,
            net_trophies: COUNT,
            partial: {
              type: "boolean",
              description:
                "Present and true when the window clips this ISO week (3.13.0); covers says the span the row holds.",
            },
            covers: {
              type: "object",
              properties: { from: ISO, to: ISO },
            },
          },
          required: ["iso_week", "week_of", "battles", "win_rate"],
        },
      },
      trophy_floor: TROPHY_FLOOR,
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
            arena_id: { type: ["integer", "null"] },
            league_number: { type: ["integer", "null"] },
            mode_group: {
              type: "string",
              description:
                "The contract's fold of type: ladder, ranked, war, casual, challenge, tournament, or other.",
            },
            deck_selection: {
              type: ["string", "null"],
              description:
                "Compact only (full carries it inside context): collection for the player's own deck, draft and the like for a chosen-on-the-spot one.",
            },
            context: {
              type: "object",
              description: "Full verbosity: the battle's own facts (0131).",
              properties: {
                event_tag: { type: ["string", "null"] },
                tournament_tag: { type: ["string", "null"] },
                ladder_tournament: { type: ["boolean", "null"] },
                hosted: { type: ["boolean", "null"] },
                deck_selection: { type: ["string", "null"] },
              },
            },
            boat: {
              type: "object",
              description:
                "Full verbosity, boat battles only: the attacking side and the towers before, after and remaining.",
              properties: {
                side: { type: ["string", "null"] },
                towers_before: { type: ["integer", "null"] },
                towers_after: { type: ["integer", "null"] },
                remaining: { type: ["integer", "null"] },
              },
            },
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
      comparable: {
        type: "boolean",
        description:
          "false when the rows were played in different modes or at level gaps half a level apart, so their win rates do not rank the decks (3.13.0); the first note says which rows clash.",
      },
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
            modes: MODE_SPLIT,
            dominant_mode: { type: "string" },
            dominant_mode_share: RATE,
            mean_level_gap: LEVEL_GAP,
            own_mean_level: { type: ["number", "null"] },
            opponent_mean_level: { type: ["number", "null"] },
            level_gap_battles: COUNT,
            first_used: ISO,
            last_used: ISO,
          },
          required: [
            "deck_hash",
            "cards",
            "battles",
            "win_rate",
            "modes",
            "mean_level_gap",
          ],
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
            finish_time: {
              type: ["string", "null"],
              description:
                "When the clan's boat crossed the line; null for a clan that has not (the API's epoch-zero sentinel is never served).",
            },
            clan_score: {
              type: ["integer", "null"],
              description:
                "The game's own strength number for the clan, latest observed (3.15.0).",
            },
            repair_points: { type: ["integer", "null"] },
          },
          required: ["participant_clan_tag", "fame", "period_points"],
        },
      },
      participants: { type: "array" },
      participants_count: COUNT,
      member_count: COUNT,
      members_not_in_race: { type: "array" },
      period: {
        type: "object",
        properties: {
          api_period_type: {
            type: ["string", "null"],
            description:
              "The API's own word for the day at the last race poll: training, warDay or colosseum (3.15.0).",
          },
        },
      },
      days_closed: {
        type: "array",
        description:
          "Full verbosity: the race's own day-by-day (periodLogs), one entry per closed war day (3.15.0).",
        items: {
          type: "object",
          properties: {
            war_day: { type: ["integer", "null"] },
            period_index: COUNT,
            standings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  clan_tag: TAG,
                  name: { type: ["string", "null"] },
                  points_earned: NULLABLE_INT,
                  progress_start: NULLABLE_INT,
                  progress_end: NULLABLE_INT,
                  progress_earned: NULLABLE_INT,
                  end_of_day_rank: {
                    type: ["integer", "null"],
                    description:
                      "The API's endOfDayRank, 0-based; -1 means not yet ranked. rank is the 1-based reading.",
                  },
                  rank: {
                    type: ["integer", "null"],
                    description:
                      "1-based placement at day end, like every other rank here; null while unranked.",
                  },
                  defenses_remaining: NULLABLE_INT,
                  progress_from_defenses: NULLABLE_INT,
                },
                required: ["clan_tag"],
              },
            },
          },
          required: ["period_index", "standings"],
        },
      },
      race_finished_at: { type: ["string", "null"] },
      decks_today: {
        type: ["object", "null"],
        properties: {
          war_day: COUNT,
          race_finished_at: { type: ["string", "null"] },
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
      type: {
        type: ["string", "null"],
        description:
          "open, inviteOnly or closed, as the last roster poll carried it (3.15.0).",
      },
      location_id: NULLABLE_INT,
      description: { type: ["string", "null"] },
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
            years_played: NULLABLE_INT,
            account_age_days: NULLABLE_INT,
            badge_count: COUNT,
            lifetime: {
              type: ["object", "null"],
              description:
                "As of the latest profile poll; null for a member whose profile is not recorded.",
              properties: {
                as_of: ISO,
                best_trophies: NULLABLE_INT,
                battle_count: NULLABLE_INT,
                wins: NULLABLE_INT,
                losses: NULLABLE_INT,
                three_crown_wins: NULLABLE_INT,
                collection_level: NULLABLE_INT,
                king_tower_level: NULLABLE_INT,
                total_donations: NULLABLE_INT,
                war_day_wins: NULLABLE_INT,
                clan_cards_collected: NULLABLE_INT,
                legacy_trophy_road_high_score: NULLABLE_INT,
              },
            },
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

  players_timeline: {
    type: "object",
    properties: {
      player_tag: TAG,
      applied: {
        type: "object",
        properties: { window: WINDOW_ECHO, kind: { type: "string" } },
        required: ["window"],
      },
      snapshots_available_from: { type: ["string", "null"] },
      series: { type: "array", items: SERIES_POINT },
      progress: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            mode: { type: "string" },
            season_month: { type: ["string", "null"] },
            day: DATE,
            observed_at: ISO,
            trophies: NULLABLE_INT,
            best_trophies: NULLABLE_INT,
            arena_id: NULLABLE_INT,
          },
          required: ["key", "day", "observed_at"],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "player_tag",
      "applied",
      "snapshots_available_from",
      "series",
      "notes",
      "docs",
      "meta",
    ],
  },

  clans_timeline: {
    type: "object",
    properties: {
      clan_tag: TAG,
      applied: {
        type: "object",
        properties: { window: WINDOW_ECHO, kind: { type: "string" } },
        required: ["window"],
      },
      series_available_from: { type: ["string", "null"] },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            day: DATE,
            iso_week: { type: "string" },
            kind: {
              type: "string",
              enum: ["daily", "pre_reset", "season_roll"],
            },
            observed_at: ISO,
            source: { type: "string", enum: ["api", "elixir-bot"] },
          },
          required: ["day", "kind", "observed_at", "source"],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "clan_tag",
      "applied",
      "series_available_from",
      "series",
      "notes",
      "docs",
      "meta",
    ],
  },

  clans_members_timeline: {
    type: "object",
    properties: {
      clan_tag: TAG,
      applied: {
        type: "object",
        properties: {
          window: WINDOW_ECHO,
          kind: { type: "string" },
          limit: COUNT,
        },
        required: ["window"],
      },
      member_count: COUNT,
      members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player_tag: TAG,
            name: { type: ["string", "null"] },
            points: COUNT,
            series: { type: "array", items: SERIES_POINT },
            first: { anyOf: [SERIES_POINT, { type: "null" }] },
            last: { anyOf: [SERIES_POINT, { type: "null" }] },
            delta: { type: ["object", "null"] },
          },
          required: ["player_tag", "points"],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "clan_tag",
      "applied",
      "member_count",
      "members",
      "notes",
      "docs",
      "meta",
    ],
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
      members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player_tag: TAG,
            rank: COUNT,
            percentile: {
              type: "number",
              description: "1 - (rank - 1) / ranked_members.",
            },
            win_rate: RATE,
          },
          required: ["player_tag", "rank", "percentile"],
        },
      },
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

  elixir_timeline: {
    type: "object",
    properties: {
      applied: { type: "object" },
      window: {
        type: "object",
        properties: { from: ISO, to: ISO },
        required: ["from", "to"],
      },
      read_to: { type: ["string", "null"] },
      timeline: {
        type: "array",
        items: {
          type: "object",
          properties: {
            at: ISO,
            subject_tag: { type: ["string", "null"] },
            subject_name: { type: ["string", "null"] },
            kind: { type: "string" },
            section: { type: "string" },
            text: { type: "string" },
            facts: { type: "object" },
          },
          required: ["at", "kind", "section", "text", "facts"],
        },
      },
      timeline_more: COUNT,
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["player_activity", "clan_activity"],
            },
            subject_tag: TAG,
            name: { type: ["string", "null"] },
            summary: { type: "string" },
            window: { type: "object" },
            notables: { type: "array" },
          },
          required: ["kind", "subject_tag", "summary", "window"],
        },
      },
      quiet: { type: "array" },
      subjects: COUNT,
      next_cursor: ISO,
      has_more: { type: "boolean" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "applied",
      "window",
      "read_to",
      "timeline",
      "entries",
      "quiet",
      "next_cursor",
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
          average_ratio: {
            type: ["string", "null"],
            description:
              'A string with three decimals ("0.667") until 4.0.0, which makes it a number; the interval ratio beside it is already a number.',
          },
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
