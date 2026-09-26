/**
 * Attested facts (JSON API 2.2.0, contract 9.2.0; Jamie, 2026-09-25): what
 * a person did in a clan through one of the Elixir family's apps (a
 * leader says a departure was a kick, a promotion made, an award granted,
 * a message sent to the clan), or what a family app's own game produced
 * for a player (a personal record in Elixir Drop). Elixir holds them
 * APART from the game record, which stays what collectors saw, each
 * labelled with who attested it, in which app, as what role, and when.
 * They are facts with a named source, never Elixir's judgment: nothing
 * here scores, ranks or recommends.
 *
 * Who may see one is its type's `visibility` (Jamie, 2026-09-25):
 *   - `clan`: anyone whose verified player is in the clan, and an agent
 *     whose owner's is;
 *   - `leaders`: a person whose verified player leads the clan (leader or
 *     co-leader). Never an agent, never mail;
 *   - `player`: whoever has the player on their timeline (the player and
 *     those who follow them).
 *
 * A departure's kind is `clan` since 9.3.0 (Jamie, 2026-09-25: "in clan
 * chat everyone sees that the person was kicked. We then comment on it so
 * everyone knows why"). It shipped as `leaders` in 9.2.0 so that a kick
 * would never be narrated; the game already tells the whole clan, so
 * keeping it from the clan's own agent kept nothing from anyone.
 *
 * `app` among a clan fact's attesters (9.6.0) means the family app itself
 * writes it on its integration key (`facts:write`), not a person: what the
 * app computed from its own rules (Elixir Clan's award standings), labelled
 * as the app's, never passed off as a leader's word.
 *
 * This registry is the one list: the write routes validate against it, and
 * the timeline reads its kinds AND who sees each from it at read time, so a
 * change here reaches rows written before it.
 */

export type FactVisibility = "clan" | "leaders" | "player";
export type FactSubject = "clan" | "player";

/** One field of a fact's detail. */
export interface FactField {
  type: "enum" | "string" | "integer" | "instant";
  values?: readonly string[];
  max?: number;
  min?: number;
  optional?: boolean;
  nullable?: boolean;
}

export interface FactType {
  subject: FactSubject;
  visibility: FactVisibility;
  /** Clan facts: the in-game roles that may attest it; `self` lets the
   *  member it is about attest it too; `app` is the family app on its
   *  integration key (9.6.0). Player facts are an integration's. */
  attesters: readonly string[];
  /** Whether the fact is about one member (`player_tag` required). */
  member: boolean;
  detail: Readonly<Record<string, FactField>>;
  /** What the fact says, for the docs. */
  about: string;
}

const LEADERS = ["leader", "coLeader"] as const;
const ROLES = ["member", "elder", "coLeader", "leader"] as const;

export const ATTESTED_FACT_TYPES: Readonly<Record<string, FactType>> = {
  departure_classified: {
    subject: "clan",
    visibility: "clan",
    attesters: LEADERS,
    member: true,
    detail: {
      kind: { type: "enum", values: ["kick", "leave"] },
      left_at: { type: "instant", optional: true },
    },
    about:
      "A leader says whether a member who left was kicked or left on their own; the roster records only that they went.",
  },
  role_change_made: {
    subject: "clan",
    visibility: "clan",
    attesters: LEADERS,
    member: true,
    detail: {
      from: { type: "enum", values: ROLES },
      to: { type: "enum", values: ROLES },
    },
    about:
      "A leader says they promoted or demoted a member; the roster's role_changed is the game's own record of the move.",
  },
  award_granted: {
    subject: "clan",
    visibility: "clan",
    attesters: [...LEADERS, "elder"],
    member: true,
    detail: {
      award: { type: "string", max: 60 },
      season_id: { type: "integer", min: 1, max: 9999 },
      place: { type: "integer", min: 1, max: 50, optional: true },
    },
    about:
      "The clan granted a member one of its own awards for a season (the clan's award, not the game's).",
  },
  member_away: {
    subject: "clan",
    visibility: "leaders",
    attesters: [...LEADERS, "self"],
    member: true,
    detail: {
      until: { type: "instant", optional: true, nullable: true },
    },
    about: "A member says they will be away, until an instant or for now.",
  },
  clan_message: {
    subject: "clan",
    visibility: "clan",
    attesters: [...LEADERS, "elder"],
    member: false,
    detail: {
      channel: { type: "enum", values: ["leader_message", "clan_chat"] },
      title: { type: "string", max: 24, optional: true },
      body: { type: "string", max: 200 },
    },
    about:
      "A message sent to the clan in the game: a Clan Leader Message (leaders and co-leaders only) or a clan chat line. The game's API carries neither.",
  },
  personal_record: {
    subject: "player",
    visibility: "player",
    attesters: [],
    member: false,
    detail: {
      game: { type: "string", max: 40 },
      score: { type: "integer", min: 0, max: 1_000_000_000 },
      previous_best: {
        type: "integer",
        min: 0,
        max: 1_000_000_000,
        optional: true,
        nullable: true,
      },
    },
    about:
      "A family app's own game produced a new personal best for the player (Elixir Drop).",
  },
  award_standing: {
    subject: "clan",
    visibility: "clan",
    attesters: ["app"],
    member: true,
    detail: {
      award: { type: "string", max: 60 },
      award_id: { type: "string", max: 40 },
      season_id: { type: "integer", min: 1, max: 9999 },
      place: { type: "integer", min: 1, max: 10 },
      value: { type: "integer", min: 0, max: 1_000_000_000 },
      unit: { type: "enum", values: ["points", "donations", "war_decks"] },
      as_of: { type: "instant" },
      previous_player_tag: {
        type: "string",
        max: 16,
        optional: true,
        nullable: true,
      },
    },
    about:
      "Where a member stands in one of the clan's own awards for a season still running, as the clan's app computed it from its rules: the place, the value and unit, as of when. previous_player_tag names who held the place before, when that changed.",
  },
};

export const ATTESTED_FACT_KINDS: readonly string[] =
  Object.keys(ATTESTED_FACT_TYPES);

/** Only this role may send a Clan Leader Message in the game. */
export const LEADER_MESSAGE_ROLES: readonly string[] = LEADERS;

/** The family's apps as a person reads their names. */
export const FAMILY_APP_NAMES: Readonly<Record<string, string>> = {
  "clan.poapkings.com": "Elixir Clan",
  "drop.poapkings.com": "Elixir Drop",
  "elixir.poapkings.com": "Elixir",
  "elixir-drop": "Elixir Drop",
  "elixir-clan": "Elixir Clan",
};
