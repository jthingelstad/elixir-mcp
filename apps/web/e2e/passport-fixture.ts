/**
 * Passports for the journeys (#1015): invented players and passport ids
 * only. MINE is the signed-in owner's (Grace), THEIRS another member's
 * (Ada, the player fixture's verified player).
 */
import { ME } from "./fixtures.ts";
import { ADA } from "./player-fixture.ts";

export const MINE = "abcdefghjkmn";
export const THEIRS = "pqrstuvwxyz2";
export const GRACE = "#0J0RVYRR";
/** A card whose art the journeys serve, and one whose art fails. */
export const ART = 26000021;
export const BROKEN_ART = 26000010;

/** The owner: Grace, verified, as the session names her. */
export const OWNER_ME = {
  ...ME,
  avatar_card_id: ART,
  claims: [
    {
      player_tag: GRACE,
      name: "Grace",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  player_verifications: { [GRACE]: true },
};

const earned = (
  stamp_id: string,
  level: number,
  earned_on: string | null,
  earned_before: string | null = null,
) => ({ stamp_id, level, earned_on, earned_before });

const progress = (
  stamp_id: string,
  earned_level: number,
  count: number,
  next: number | null,
  top: number,
  unknown = false,
) => ({ stamp_id, earned_level, progress: { count, next, top, unknown } });

export const OWN_PASSPORT = {
  passport: {
    id: MINE,
    display_name: "Grace",
    player: { tag: GRACE, name: "Grace", verified: true, avatar_card_id: ART },
    earned: [
      earned("player_verified", 1, "2026-11-01"),
      earned("looking_good", 1, null, "2026-10-01"),
      earned("mutual", 1, "2026-11-08"),
      earned("cheerleader", 2, "2026-11-12"),
    ],
  },
  catalog_version: 1,
  owner: {
    profile: { version: 1, complete: false, steps: [] },
    stamps: [
      progress("player_verified", 1, 1, null, 1),
      progress("looking_good", 1, 1, null, 1),
      progress("on_the_map", 0, 0, 1, 1),
      progress("full_roster", 0, 0, 1, 1),
      progress("linked", 0, 0, 1, 1),
      progress("all_set", 0, 0, 1, 1),
      progress("inner_circle", 0, 3, 5, 5, true),
      progress("mutual", 1, 1, null, 1),
      progress("played_together", 0, 0, 1, 20),
      progress("cheerleader", 2, 18, 50, 50),
      progress("storyteller", 0, 0, 1, 20),
    ],
  },
};

/** Another member's passport: the public projection alone. */
export const THEIR_PASSPORT = {
  passport: {
    id: THEIRS,
    display_name: ADA.player.name,
    player: {
      tag: ADA.player.tag,
      name: ADA.player.name,
      verified: true,
      avatar_card_id: BROKEN_ART,
    },
    earned: [
      earned("player_verified", 1, "2026-10-20"),
      earned("on_the_map", 1, "2026-11-03"),
      earned("storyteller", 1, "2026-11-11"),
    ],
  },
  catalog_version: 1,
};

/** The same member after their proof lapsed: Player verified stays
 *  earned, the gold mark goes. */
export const LAPSED_PASSPORT = {
  ...THEIR_PASSPORT,
  passport: {
    ...THEIR_PASSPORT.passport,
    player: {
      ...THEIR_PASSPORT.passport.player,
      verified: false,
      avatar_card_id: null,
    },
  },
};

/** An account with no player at all. */
export const NEW_PASSPORT = {
  passport: {
    id: THEIRS,
    display_name: "New player",
    player: null,
    earned: [],
  },
  catalog_version: 1,
};

/** Ada's page, with her passport in one row. */
export const ADA_WITH_PASSPORT = {
  ...ADA,
  passport: {
    id: THEIRS,
    count: 3,
    marks: [
      { stamp_id: "storyteller", level: 1 },
      { stamp_id: "on_the_map", level: 1 },
    ],
  },
};
