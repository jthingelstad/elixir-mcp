/**
 * Where a timeline item leads (11.9.0): `follow`, the reads that expand
 * one item into its story, each a tool and the arguments to call it
 * with. The timeline is the feed that says something happened; the rest
 * of the record says how and why, and an agent turning an item into a
 * post should not have to work out which tool holds that or how to name
 * the moment to it.
 *
 * Every argument comes from the item itself (its facts, subjects, id and
 * the window that served it), never from game data kept by hand. These
 * are addresses, not advice: they say where more of the record is, not
 * what to make of it. A read the caller may not make is left out
 * (`forCaller`), and each address is held to its tool's input schema by
 * a test (timeline-follow.test.mjs).
 */

/** One second after an instant: battle windows select [from, to), so a
 *  span read to its last battle's own instant would leave that battle out
 *  (Codex on #476). Battle times are whole seconds. */
const after = (isoAt) => new Date(Date.parse(isoAt) + 1000).toISOString();

const player = (it) => it.facts?.player_tag ?? null;
/** The clan an item is about: its clan subject, or the clan a roster
 *  move names. */
const clanOf = (it) =>
  it.facts?.clan_tag ??
  it.subjects?.find((s) => s.kind === "clan")?.tag ??
  null;

const summary = (tag) =>
  tag ? [{ tool: "players_summary", args: { player_tag: tag } }] : [];
/** The battle that proved a moment, by its id. */
const battle = (tag, proof) =>
  tag && proof?.battle_id
    ? [
        {
          tool: "battles_query",
          args: { player_tag: tag, battle_id: proof.battle_id },
        },
      ]
    : [];

/**
 * The follow-up reads for one finished item. `window` is the read that
 * served it ({ from, to, basis }), so an evidence address reads it back
 * from the same window.
 */
export function followFor(it, window) {
  const f = it.facts ?? {};
  const tag = player(it);
  switch (it.kind) {
    case "battle_session":
    case "session_standout":
      return [
        ...(it.evidence
          ? [
              {
                tool: "elixir_timeline",
                args: {
                  evidence_item_id: it.id,
                  from: window.from,
                  to: window.to,
                  basis: window.basis,
                },
              },
            ]
          : []),
        ...(tag && f.started_at && f.ended_at
          ? [
              {
                tool: "battles_performance",
                args: {
                  player_tag: tag,
                  from: f.started_at,
                  to: after(f.ended_at),
                },
              },
            ]
          : []),
        // A standout's best win, by its id (2026-10-11).
        ...battle(tag, f.best_win),
      ];
    case "ranked_promotion":
    case "arena_changed":
      return [...battle(tag, f.promoted_by), ...summary(tag)];
    case "best_trophies_band":
    case "career_wins_step":
      return [...battle(tag, f.crossed_by), ...summary(tag)];
    case "badge_earned":
    case "legendary_badge_earned":
      return tag
        ? [{ tool: "players_profile", args: { player_tag: tag } }]
        : [];
    case "collection_level_step":
      return tag
        ? [{ tool: "players_collection", args: { player_tag: tag } }]
        : [];
    case "card_unlocked":
    case "card_form_unlocked":
      return tag
        ? [
            { tool: "players_collection", args: { player_tag: tag } },
            ...(Number.isInteger(f.card_id)
              ? [
                  {
                    tool: "cards_card",
                    args: { card_id: f.card_id, segment: { player_tag: tag } },
                  },
                ]
              : []),
          ]
        : [];
    case "member_joined":
    case "member_left":
    case "member_role_changed": {
      // A clan feed's move: the clan is one the reader records, so its
      // roster is there to read.
      const clan = clanOf(it);
      return [
        ...summary(tag),
        ...(clan ? [{ tool: "clans_roster", args: { clan_tag: clan } }] : []),
      ];
    }
    case "clan_joined":
    case "clan_left":
      // A player's own move may name a clan nobody records, whose roster
      // read would answer not_recorded (Codex on #476): the member only.
      return summary(tag);
    case "bracket_observed": {
      const clan = clanOf(it);
      const rivals = (f.rivals ?? []).map((r) => r.tag).filter(Boolean);
      return clan
        ? [
            {
              tool: "war_rivals",
              args: {
                clan_tag: clan,
                ...(rivals.length ? { rival_tags: rivals } : {}),
              },
            },
          ]
        : [];
    }
    case "race_finished":
    case "week_resolved": {
      const clan = clanOf(it);
      return clan &&
        Number.isInteger(f.season_id) &&
        Number.isInteger(f.section_index)
        ? [
            {
              tool: "war_history",
              args: {
                clan_tag: clan,
                season_id: f.season_id,
                section_index: f.section_index,
              },
            },
          ]
        : [];
    }
    case "quiet_crossed":
    case "returned":
      return tag
        ? [
            ...summary(tag),
            { tool: "battles_query", args: { player_tag: tag, limit: 10 } },
          ]
        : [];
    default:
      // Attested facts about a member lead to the member; the account's
      // own administration leads nowhere.
      return it.section === "attested" ? summary(tag) : [];
  }
}

/** Only the reads this caller may make: a tool hidden from its principal
 *  is no address for it. */
export const forCaller = (follow, mayCall) =>
  follow.filter((x) => mayCall(x.tool));
