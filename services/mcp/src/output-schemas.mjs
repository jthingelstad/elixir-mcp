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
/** A subject's last-observed name beside its tag (6.4.0). */
const NAME = {
  type: ["string", "null"],
  description: "Last-observed name; null when the record has none.",
};
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
    form: {
      type: "string",
      enum: ["base", "evolution", "hero"],
      description:
        "The form the card was played as (5.0.0; the integer evolution key is retired).",
    },
  },
  required: ["id", "name", "form"],
};

/** The archetype on every deck object (6.5.0, design §4.2). */
const ARCHETYPE = {
  type: "object",
  description:
    "Elixir's descriptive name for the deck's shape: win condition(s) and family, composed from the cards and their catalog costs. A noun, never a quality claim.",
  properties: {
    family: {
      type: "string",
      enum: [
        "beatdown",
        "control",
        "cycle",
        "bait",
        "bridge_spam",
        "siege",
        "unclassified",
      ],
    },
    win_conditions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: COUNT,
          name: { type: "string" },
          form: { type: "string", enum: ["base", "evolution", "hero"] },
        },
      },
    },
    secondary_win_conditions: {
      type: "array",
      description:
        "Every other attested win condition in the deck, by priority: what the label leaves out (a 'Miner control' carrying Goblin Barrel and Boss Bandit).",
    },
    named_by: {
      type: ["object", "null"],
      description:
        "With no win condition in the deck, the card the label leads with (Rune Giant beatdown) - a tank of a chip push, not a win condition; null otherwise.",
    },
    label: {
      type: "string",
      description:
        '"<win condition(s)> <family>" with the win condition\'s form said as players say it (Evo Royal Hogs bridge spam); the bare family when no attested win condition is in the deck.',
    },
    average_elixir: { type: ["number", "null"] },
    basis: { type: "string" },
    grammar_version: { type: "string" },
    roles_version: {
      type: ["string", "null"],
      description:
        "The vocabulary's version (the cr-agent-api-docs commit time the card roles were imported from); null when none is imported.",
    },
  },
  required: ["family", "win_conditions", "label", "average_elixir"],
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

/** The leaked-elixir counter as one object with its caveat on it (6.0.0,
 *  feedback #65/#66). Full verbosity only; null when the side did not
 *  report. differential is me minus the one opponent on a single-game
 *  head-to-head row and null on duels (each side's counter sums rounds
 *  played on different decks), 2v2 and unreported opponents. */
const ELIXIR = {
  type: ["object", "null"],
  description:
    "This side's leaked-elixir counter with its caveat on the value (6.0.0). leaked: the side's own counter, summed across rounds on a duel; opponent_leaked: the one opponent's on a head-to-head row (null on 2v2, teammates and opponents); differential: leaked minus opponent_leaked on a single-game head-to-head row, null on duels; rounds: how many games the counters sum over; caveat: why none of it is a skill measure. Null when the game did not report it. Full verbosity only.",
  properties: {
    leaked: { type: "number" },
    opponent_leaked: { type: ["number", "null"] },
    differential: { type: ["number", "null"] },
    rounds: { type: ["integer", "null"], minimum: 1 },
    caveat: { type: "string" },
  },
  required: ["leaked", "opponent_leaked", "differential", "rounds", "caveat"],
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
    elixir: ELIXIR,
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

/** The seven schemas the call log asked for next (3.18.0, review Part
 *  3.2): the tools called enough in fourteen days to deserve a declared
 *  shape, permissive below the keys a consumer branches on. */
const POPULATION = {
  type: "object",
  description:
    "On a corpus read: the recorded clans and players the answer was drawn from, and the distinct players in the window (null on the rollup path until the nightly rebuild).",
  properties: {
    recorded_clans: COUNT,
    recorded_players: COUNT,
    players_in_window: NULLABLE_INT,
  },
};
const META_ROW_COMMON = {
  battles: COUNT,
  wins: COUNT,
  losses: COUNT,
  players: NULLABLE_INT,
  usage_share: RATE,
  win_rate: RATE,
  shrunk_win_rate: RATE,
  insufficient_sample: { type: "boolean" },
  mean_level_gap: LEVEL_GAP,
  modes: MODE_SPLIT,
};
const META_COMMON = {
  applied: {
    type: "object",
    properties: {
      segment: { type: "object" },
      window: WINDOW_ECHO,
      mode: { type: "string" },
      trophy_band: { type: "string" },
      min_battles: COUNT,
      limit: COUNT,
    },
    required: ["segment", "window"],
  },
  population: POPULATION,
  methodology: { type: "object" },
  decided_battles: COUNT,
  segment_win_rate: RATE,
  prior_win_rate: RATE,
  prior_basis: { type: "string" },
  excluded: {
    type: "object",
    properties: {
      considered: COUNT,
      duels: COUNT,
      boat: COUNT,
      draws: COUNT,
      unresolved: COUNT,
      no_deck: COUNT,
    },
  },
  players_as_of: { type: ["string", "null"] },
  comparable: { type: "boolean" },
  modes_in_window: {
    type: "array",
    description:
      "When mode was omitted: the window's battles per mode group with each group's mean level gap, the pooled populations behind the rows.",
    items: {
      type: "object",
      properties: {
        mode: { type: "string" },
        battles: COUNT,
        mean_level_gap: LEVEL_GAP,
      },
    },
  },
  notes: NOTES,
  docs: DOCS,
  meta: META,
};
/** fit_for on the meta tools (6.4.0): the population's rows against
 *  one player's collection. */
const FIT_FOR_BLOCK = {
  type: "object",
  description:
    "Present with fit_for: whose collection, as of when, and the benchmark.",
  properties: {
    player_tag: TAG,
    collection_as_of: { type: ["string", "null"] },
    fielded_mean_level: {
      type: ["number", "null"],
      description:
        "The mean card level of the decks the player actually played (decided pvp, this window and mode); null with none.",
    },
    fielded_battles: COUNT,
    plays: {
      type: "object",
      description:
        "The families, win conditions (form included, as a label speaks them) and archetype labels of the decks the player fielded in the window and mode.",
      properties: {
        families: { type: "array", items: { type: "string" } },
        win_conditions: {
          type: "array",
          items: { type: "string" },
          description: "6.13.0: e.g. 'Evo Royal Hogs', 'Hog Rider'.",
        },
        archetypes: { type: "array", items: { type: "string" } },
      },
    },
  },
};
const DECK_FIT = {
  type: "object",
  description:
    "With fit_for: this deck against what the player holds. Levels are the 1-16 display scale.",
  properties: {
    fieldable: { type: "boolean" },
    missing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: COUNT,
          name: { type: ["string", "null"] },
          form: { type: "string" },
          reason: { type: "string", enum: ["not_owned", "form_not_unlocked"] },
        },
      },
    },
    own_mean_level: {
      type: ["number", "null"],
      description:
        "The deck's mean level at the player's held levels; null when a card is not owned.",
    },
    vs_fielded: {
      type: ["number", "null"],
      description: "own_mean_level minus fit_for.fielded_mean_level.",
    },
    upgrades: {
      type: "array",
      description:
        "The path to the fielded level: each held card below it, largest deficit first (held_level, to_level, levels).",
    },
    mean_level_after_upgrades: { type: ["number", "null"] },
    plays_family: {
      type: "boolean",
      description:
        "The player already fields a deck of this row's family in the window.",
    },
    plays_win_condition: {
      type: "boolean",
      description:
        "The player already fields one of this row's win conditions, form included (6.13.0): the card leveled and learned, whatever family it was played in.",
    },
    plays_archetype: {
      type: "boolean",
      description:
        "The player already fields a deck of this row's exact label in the window.",
    },
  },
};

export const OUTPUT_SCHEMAS = {
  elixir_my_feedback: {
    type: "object",
    properties: {
      applied: { type: "object" },
      feedback: {
        type: "array",
        items: {
          type: "object",
          properties: {
            feedback_id: {
              type: "string",
              description:
                "The id as a decimal string (a bigint on the wire); pass it back as given.",
            },
            created_at: ISO,
            surface: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            message: { type: "string" },
            status: {
              type: "string",
              enum: ["new", "seen", "planned", "done", "declined"],
            },
            response: { type: ["string", "null"] },
            responded_at: { type: ["string", "null"] },
            shipped_in: {
              type: ["string", "null"],
              description: "The contract version that shipped it, when done.",
            },
            related_tools: {
              type: ["array", "null"],
              items: { type: "string" },
            },
          },
          required: [
            "feedback_id",
            "created_at",
            "message",
            "status",
            "response",
            "responded_at",
            "shipped_in",
            "related_tools",
          ],
        },
      },
      total: COUNT,
      next_offset: {
        type: ["integer", "null"],
        description: "Pass as offset for the next page; null at the end.",
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["feedback", "total", "next_offset", "notes", "docs", "meta"],
  },

  rankings_players: {
    type: "object",
    description:
      "A board page; with location 'list', the recorded mode boards instead (boards[] and no players).",
    properties: {
      board: { type: "string", enum: ["pol", "pol_final", "mode", "trophy"] },
      location: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: ["string", "null"] },
          kind: { type: ["string", "null"] },
          country_code: { type: ["string", "null"] },
        },
        required: ["key"],
      },
      boards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            location: { type: "string" },
            name: { type: ["string", "null"] },
            enabled: { type: "boolean" },
          },
        },
      },
      applied: { type: "object" },
      live_status: { type: "object" },
      snapshot: {
        type: ["object", "null"],
        description: "null when the board has no snapshot on or before as_of.",
        properties: {
          observed_at: ISO,
          unchanged_until: ISO,
          season_id: { type: "string" },
          season_month: { type: "string" },
          entries: COUNT,
          depth: {
            type: "integer",
            description:
              "The places the board holds: 1,000 (the API's cut on a live board), 9,999 on a season final.",
          },
          full: {
            type: "boolean",
            description:
              "entries is at depth: the board is a slice of the rated field, and floor_rating is a cutoff that moves with play, not a qualification threshold.",
          },
          floor_rating: {
            type: ["integer", "null"],
            description:
              "The last place's rating: the rating floor while the board is below depth, the cutoff once it is full.",
          },
          truncated: {
            type: "boolean",
            description:
              "The API offered a cursor past the places the recorder keeps. false on a full board means the API itself served nothing past depth.",
          },
          cadence_minutes: NULLABLE_INT,
        },
        required: [
          "observed_at",
          "unchanged_until",
          "season_month",
          "entries",
          "depth",
          "full",
        ],
      },
      players: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank: COUNT,
            player_tag: TAG,
            name: { type: ["string", "null"] },
            rating: {
              type: ["integer", "null"],
              description:
                "On the pol boards the player's Path of Legends rating: the profile's pol_trophies.",
            },
            clan_tag: { type: ["string", "null"] },
            clan_name: { type: ["string", "null"] },
          },
          required: ["rank", "player_tag", "rating"],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["board", "applied", "notes", "docs", "meta"],
  },

  war_history: {
    type: "object",
    properties: {
      clan_tag: TAG,
      name: NAME,
      applied: { type: "object" },
      weeks: {
        type: "array",
        description: "Newest first.",
        items: {
          type: "object",
          properties: {
            season_id: COUNT,
            section_index: COUNT,
            is_colosseum: { type: "boolean" },
            in_progress: { type: "boolean" },
            finished: { type: ["string", "null"] },
            closed_at: { type: ["string", "null"] },
            our_rank: NULLABLE_INT,
            our_fame: NULLABLE_INT,
            our_clan_score: NULLABLE_INT,
            our_repair_points: NULLABLE_INT,
            finished_early: {
              type: ["boolean", "null"],
              description:
                "True on a regular week whose boat reached the 10,000-fame line, false when it did not; null on a Colosseum week (no finish line) or without a standings capture (6.11.0: was computed as fame exactly 10,000, which a live-polled week never equals).",
            },
            finish_war_day: {
              type: ["integer", "null"],
              description:
                "The war day whose close carried the boat over the line, from the race's own day-by-day; null when the log does not hold the week or the boat did not finish.",
            },
            trophy_change: NULLABLE_INT,
          },
          required: ["season_id", "section_index", "is_colosseum", "finished"],
        },
      },
      history_starts_at: {
        type: "object",
        properties: { season_id: COUNT, section_index: COUNT },
      },
      member: TAG,
      member_weeks: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            player_tag: TAG,
            name: { type: ["string", "null"] },
            season_id: COUNT,
            section_index: COUNT,
            points: NULLABLE_INT,
            decks_used: NULLABLE_INT,
            scoring_decks: {
              type: ["integer", "null"],
              description:
                "decks_used less the decks played on the war days after the boat finished, which earn nothing: the denominator of a points-per-deck rate. Equal to decks_used on an unfinished week; null when the record cannot separate the two (6.11.0).",
            },
            boat_attacks: NULLABLE_INT,
            repair_points: NULLABLE_INT,
            war_days_battled: {
              type: ["integer", "null"],
              description:
                "null when neither polls nor recorded battles covered the week.",
            },
            war_days: { type: ["array", "null"], items: COUNT },
          },
          required: ["player_tag", "season_id", "section_index", "points"],
        },
      },
      standings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            clan_tag: TAG,
            name: { type: ["string", "null"] },
            fame: NULLABLE_INT,
            period_points: NULLABLE_INT,
            rank: NULLABLE_INT,
            trophy_change: NULLABLE_INT,
            finish_time: { type: ["string", "null"] },
            clan_score: NULLABLE_INT,
            repair_points: NULLABLE_INT,
          },
        },
      },
      days: { type: "array" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: ["clan_tag", "applied", "weeks", "notes", "docs", "meta"],
  },

  battles_meta_decks: {
    type: "object",
    properties: {
      ...META_COMMON,
      decks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            deck_hash: { type: "string" },
            ...META_ROW_COMMON,
            first_used: { type: ["string", "null"] },
            last_used: { type: ["string", "null"] },
            level_gap_battles: NULLABLE_INT,
            dominant_mode: { type: ["object", "null"] },
            cards: {
              type: "array",
              items: DECK_CARD,
              description:
                "Full verbosity; compact carries card_names instead.",
            },
            card_names: {
              type: "string",
              description:
                "Compact verbosity (6.12.0): the eight cards as one string, Evo/Hero prefixed by form.",
            },
            archetype_label: {
              type: ["string", "null"],
              description: "Compact verbosity (6.12.0): archetype.label alone.",
            },
            archetype: ARCHETYPE,
            tower_troop: { type: ["object", "null"] },
            fit: DECK_FIT,
          },
          required: ["deck_hash", "battles", "wins", "losses", "win_rate"],
        },
      },
      fit_for: FIT_FOR_BLOCK,
      archetypes: {
        type: "array",
        description:
          "With group_by: the population's decks folded by archetype label or family - decks, battles, record, players, share; members[] (player_tag, name, battles, wins, deck_hash) on a clan, player or collection segment. Sorted by players then battles; no shrunk rate.",
      },
      unfieldable: {
        type: "array",
        description:
          "With fit_for: the rows the player cannot field as held (a card not owned or a form not unlocked), the same shape as decks[], each fit.missing naming why. Absent without fit_for.",
      },
    },
    required: ["applied", "decided_battles", "decks", "notes", "docs", "meta"],
  },

  battles_meta_cards: {
    type: "object",
    properties: {
      ...META_COMMON,
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            card_id: COUNT,
            name: { type: ["string", "null"] },
            form: {
              type: "string",
              enum: ["base", "evolution", "hero"],
              description: "The card FORM this row counts (5.0.0).",
            },
            ...META_ROW_COMMON,
            held: {
              type: ["object", "null"],
              description:
                "With fit_for: what the player holds of the card - level, forms_unlocked, has_form (the row's form is unlocked) - or null when not owned. Absent without fit_for.",
            },
          },
          required: ["card_id", "battles", "wins", "losses", "win_rate"],
        },
      },
      fit_for: FIT_FOR_BLOCK,
    },
    required: ["applied", "decided_battles", "cards", "notes", "docs", "meta"],
  },

  clans_participation: {
    type: "object",
    properties: {
      clan_tag: TAG,
      name: { type: ["string", "null"] },
      applied: {
        type: "object",
        properties: {
          clan_tag: TAG,
          weeks: COUNT,
          verbosity: { type: "string" },
          window: WINDOW_ECHO,
        },
        required: ["weeks", "window"],
      },
      recording_active_since: { type: ["string", "null"] },
      first_roster_observed_at: { type: ["string", "null"] },
      basis: { type: "string", enum: ["recorded", "roster_and_war_only"] },
      weeks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            iso_week: { type: "string" },
            from: ISO,
            to: ISO,
            partial: {
              type: "boolean",
              description:
                "Present and true on the current week, which now clips (4.0.0; complete: false before); covers says the span it holds.",
            },
            covers: { type: "object", properties: { from: ISO, to: ISO } },
          },
          required: ["iso_week", "from", "to"],
        },
      },
      war_weeks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            season_id: COUNT,
            section_index: COUNT,
            is_colosseum: { type: "boolean" },
            started_observed_at: { type: ["string", "null"] },
            finished_observed_at: { type: ["string", "null"] },
          },
          required: ["season_id", "section_index"],
        },
      },
      member_count: COUNT,
      members: {
        type: "array",
        description:
          "Per-member columns aligned to weeks[] (battles, ranked_battles, donations) and war_weeks[] (war_decks, war_points, war_decks_by_day, war_battles_by_day, war_days_battled), one entry each in order; null is unknown, never zero.",
        items: {
          type: "object",
          properties: {
            player_tag: TAG,
            name: { type: ["string", "null"] },
            role: { type: ["string", "null"] },
            joined_observed_at: { type: ["string", "null"] },
            tenure_known: { type: "boolean" },
            days_in_clan_observed: NULLABLE_INT,
            log_recorded: { type: "boolean" },
            recorded_since: { type: ["string", "null"] },
            last_battle_time: { type: ["string", "null"] },
            last_battle_time_in_clan: { type: ["string", "null"] },
            days_since_battle: { type: ["number", "null"] },
            battles: { type: "array", items: NULLABLE_INT },
            ranked_battles: { type: "array", items: NULLABLE_INT },
            donations: { type: "array", items: NULLABLE_INT },
            war_decks: { type: "array", items: NULLABLE_INT },
            war_points: { type: "array", items: NULLABLE_INT },
            war_decks_by_day: { type: "array" },
            war_battles_by_day: { type: "array" },
            war_days_battled: { type: "array", items: NULLABLE_INT },
          },
          required: [
            "player_tag",
            "tenure_known",
            "log_recorded",
            "battles",
            "war_decks",
            "war_days_battled",
          ],
        },
      },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "clan_tag",
      "applied",
      "basis",
      "weeks",
      "war_weeks",
      "members",
      "notes",
      "docs",
      "meta",
    ],
  },

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
          archetype: ARCHETYPE,
          battles: COUNT,
          win_rate: RATE,
          modes: MODE_SPLIT,
          dominant_mode: {
            type: ["object", "null"],
            properties: { mode: { type: "string" }, share: RATE },
          },
          mean_level_gap: {
            type: ["number", "null"],
            description:
              "Mean of the player's deck-average level minus the opposing side's over the deck's battles (3.17.0); the figure the comparability note compares between the two decks.",
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

  players_collection: {
    type: "object",
    description:
      "The collection's own facts per card (6.14.0): the catalog's - iconUrls, rarity, elixirCost, maxLevel, maxLevelRarityScale - are cards_catalog's, once.",
    properties: {
      player_tag: TAG,
      applied: { type: "object" },
      collection_level: NULLABLE_INT,
      fielded: {
        type: "object",
        properties: {
          days: COUNT,
          mean_level: { type: ["number", "null"] },
          battles: COUNT,
        },
        required: ["days", "mean_level", "battles"],
      },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: COUNT,
            name: { type: ["string", "null"] },
            level: COUNT,
            count: COUNT,
            starLevel: COUNT,
            evolutionLevel: COUNT,
            maxEvolutionLevel: COUNT,
            forms_available: { type: "array", items: { type: "string" } },
            forms_unlocked: { type: "array", items: { type: "string" } },
          },
          required: ["id", "level", "forms_unlocked"],
        },
      },
      support_cards: { type: "array" },
      as_of_payload: { type: "string" },
      notes: NOTES,
      docs: DOCS,
      meta: META,
    },
    required: [
      "player_tag",
      "applied",
      "cards",
      "as_of_payload",
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
      badges: {
        type: "array",
        description:
          "Current badge state: name is the API's identifier (MasterySkeletonWarriors), label the badge as a player says it (Guards Mastery, 4.2.0); level, max_level, progress, target where tiered.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            level: NULLABLE_INT,
            max_level: NULLABLE_INT,
            progress: NULLABLE_INT,
            target: NULLABLE_INT,
          },
          required: ["name", "label"],
        },
      },
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
              "The lifetime block as the last profile poll carried it, in the names clans_roster and players_timeline speak (4.0.0: one shape); null on a profile that never carried the counters.",
            properties: {
              wins: NULLABLE_INT,
              losses: NULLABLE_INT,
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
            trophy_mode_battles: {
              ...COUNT,
              description:
                "Trophy Road and Path of Legends battles played this week (4.1.0): the denominator for ladder games; trophy_battles is the subset that reported a trophy delta.",
            },
            trophy_battles: {
              ...COUNT,
              description:
                "Trophy-mode battles that reported a trophy delta; a loss standing on an arena floor reports none and is outside this count.",
            },
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
      name: NAME,
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
            arena: {
              type: "object",
              description:
                "The higher side's arena, stamped at battle time (4.0.0: one {id, name} shape with trophy_floor.arena and modal_arena); id is null on a row the 0131 backfill never reached.",
              properties: {
                id: { type: ["integer", "null"] },
                name: { type: ["string", "null"] },
              },
              required: ["id", "name"],
            },
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
            me: {
              type: "object",
              properties: {
                player_tag: TAG,
                name: NAME,
                outcome: { type: "string" },
                crowns: { type: ["integer", "null"] },
                trophy_change: { type: ["integer", "null"] },
                starting_trophies: { type: ["integer", "null"] },
                deck_hash: { type: ["string", "null"] },
                rounds_played: COUNT,
                deck: { type: ["object", "null"] },
                elixir: ELIXIR,
                tower_hp: { type: ["object", "null"] },
              },
              required: ["outcome"],
            },
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
      name: NAME,
      applied: {
        type: "object",
        properties: { window: WINDOW_ECHO },
        required: ["window"],
      },
      total_battles_in_window: {
        ...COUNT,
        description:
          "Head-to-head battles with a deck in the window, the denominator of share_of_battles; duels have no single deck and sit in excluded (4.1.0).",
      },
      excluded: {
        type: "object",
        description:
          "Battles in the window outside the rows (4.1.0): duels (no single deck) and any other battle with no recorded deck; total_battles_in_window plus these is battles_performance.battles over the same window.",
        properties: { duels: COUNT, no_deck: COUNT },
        required: ["duels", "no_deck"],
      },
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
            archetype: ARCHETYPE,
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
      finish_war_day: {
        type: ["integer", "null"],
        description:
          "The war day whose close carried this clan's boat over the line (6.11.0); null while it has not finished or when the day-by-day log does not say. participants[].scoring_decks is decks_used less the decks played on the days after it.",
      },
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
                "As of the latest profile poll (profile_observed_at, the stamp every series point uses); null for a member whose profile is not recorded.",
              properties: {
                profile_observed_at: ISO,
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
      comparable: {
        type: "boolean",
        description:
          "false when two ranked members' records come predominantly from different mode groups or from level gaps half a level apart; the first note then names them (3.16.0).",
      },
      basis: {
        type: "string",
        enum: ["recorded", "roster_and_war_only"],
        description:
          "recorded when the clan's members' battle logs are recorded; roster_and_war_only for an activity-scope clan, where every count is zero by construction for a member whose log_recorded is false (3.16.0).",
      },
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
            net_trophies: {
              type: ["integer", "null"],
              description:
                "Sum of trophy_change on ladder battles in the window, the name battles_performance uses (4.0.0; trophy_net before); null when ladder_battles is 0.",
            },
            ladder_battles: COUNT,
            modes: MODE_SPLIT,
            mean_level_gap: LEVEL_GAP,
            level_gap_battles: {
              type: "integer",
              description:
                "The member's latest leveled battles in the window the gap was averaged over, at most 50.",
            },
            log_recorded: { type: "boolean" },
            recorded_since: { type: ["string", "null"] },
          },
          required: ["player_tag", "rank", "percentile", "modes"],
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
            type: ["number", "null"],
            description:
              "Captured over expected battles across the measured intervals, weighted by expected battles, three decimals (a number since 4.0.0); null with no measured interval.",
          },
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
