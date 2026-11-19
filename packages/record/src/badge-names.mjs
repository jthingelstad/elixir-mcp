/**
 * Badge names the way a player would say them.
 *
 * The API names a badge by Supercell's internal identifier
 * (`MasterySkeletonWarriors`, `Crl20Wins2024`, `SeasonalBadge_202509`)
 * and carries no display name; only the icon is the player's. The
 * identifier stays the badge's `name` everywhere (players_profile serves
 * it, the timeline keys on it), and `badgeLabel` is served BESIDE it
 * so a mail, a timeline line or an agent can say "Guards Mastery" for
 * the badge the game calls MasterySkeletonWarriors (Jamie, 2026-09-19:
 * the milestone mail read like code).
 *
 * Mastery badges are `Mastery` + the card's INTERNAL name, which is the
 * card's shown name with the spaces removed for most cards and an
 * older codename for the rest (SkeletonWarriors is Guards, AxeMan is
 * Executioner, RageBarbarian is Lumberjack). The codenames are pinned
 * here from the community card data (RoyaleAPI cr-api-data sc_key,
 * checked 2026-09-19); the three newest cards' codenames are inferred
 * from what the badge can only be (the corpus holds exactly those three
 * Mastery badges with no card to match) and marked so.
 */

/** Internal card name -> the card's shown name, where splitting the
 *  CamelCase would not give it. */
const CARD_CODENAMES = {
  Archer: "Archers",
  SkeletonWarriors: "Guards",
  IceSpirits: "Ice Spirit",
  FireSpirits: "Fire Spirit",
  ZapMachine: "Sparky",
  RageBarbarian: "Lumberjack",
  IceGolemite: "Ice Golem",
  BlowdartGoblin: "Dart Goblin",
  AngryBarbarians: "Elite Barbarians",
  AxeMan: "Executioner",
  Assassin: "Bandit",
  DarkWitch: "Night Witch",
  Ghost: "Royal Ghost",
  MiniSparkys: "Zappies",
  MovingCannon: "Cannon Cart",
  SkeletonBalloon: "Skeleton Barrel",
  DartBarrell: "Flying Machine",
  EliteArcher: "Magic Archer",
  WitchMother: "Mother Witch",
  FirespiritHut: "Furnace",
  BarbLog: "Barbarian Barrel",
  Heal: "Heal Spirit",
  Snowball: "Giant Snowball",
  Xbow: "X-Bow",
  Log: "The Log",
  Pekka: "P.E.K.K.A",
  MiniPekka: "Mini P.E.K.K.A",
  Wallbreakers: "Wall Breakers",
  "Elixir Collector": "Elixir Collector",
  // Inferred (2026-09-19): the three Mastery badges the corpus holds
  // with no card name to match, against the three cards with no badge.
  GiantBuffer: "Rune Giant",
  DarkMagic: "Void",
  MergeMaiden: "Spirit Empress",
};

/** Non-Mastery badges whose identifier does not split into the name a
 *  player uses. Everything else goes through `words`. */
const BADGE_NAMES = {
  "2v2": "2v2",
  "2xElixir": "Double Elixir",
  RampUp: "Ramp Up",
  SuddenDeath: "Sudden Death",
  Draft: "Draft",
  Grand12Wins: "Grand Challenge 12 Wins",
  Classic12Wins: "Classic Challenge 12 Wins",
  BeatingDeathBadge: "Beating Death",
  EasterEgg: "Easter Egg",
  LadderTop1000: "Ladder Top 1000",
  LadderTournamentTop1000: "Ladder Tournament Top 1000",
  ClanWarsVeteran: "Clan Wars Veteran",
  ClanWarWins: "Clan War Wins",
  ClanDonations: "Clan Donations",
  YearsPlayed: "Years Played",
  BattleWins: "Battle Wins",
  CollectionLevel: "Collection Level",
  EmoteCollection: "Emote Collection",
  BannerCollection: "Banner Collection",
  SupercellEmployee: "Supercell Employee",
  SupercellPancake: "Supercell Pancake",
  Creator: "Creator",
  MegaDraftLeagueBadge: "Mega Draft League",
  TouchdownLeagueBadge: "Touchdown League",
  Chaos_S2: "Chaos Season 2",
  Royals2v2_2024: "Royals 2v2 2024",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "SkeletonDragons" -> "Skeleton Dragons"; digits and runs of capitals
 *  stay together ("Crl20Wins2024" -> "Crl 20 Wins 2024"). */
function words(id) {
  return (
    String(id)
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      // "2v2LeagueRank": the mode is one word, not "2v 2" (Gym #92).
      .replace(/(\d)v (\d)/g, "$1v$2")
      .trim()
  );
}

/** The API's version suffix (`RoyalTournamentRank_v2`), said: two
 *  identifiers that differ only by it are two badges, and one label for
 *  both made the legacy one read as the rarest badge in the game (Gym
 *  #92: 1 holder of "Royal Tournament Rank" beside 746 of the same
 *  label). Only the suffixed one says it; the original keeps its name.
 *  A dated badge (SeasonalBadge_202507_v2) is left alone: the month is
 *  what a player says, and the corpus shows no dated pair colliding. */
function versioned(id, label) {
  const v = /_v(\d+)$/.exec(id);
  return v ? `${label} (v${v[1]})` : label;
}

/** The card a Mastery badge is for, by its shown name; null for a badge
 *  that is not a Mastery badge. */
export function masteryCard(name) {
  const m = /^Mastery(.+)$/.exec(String(name ?? ""));
  if (!m) return null;
  const inner = m[1];
  return CARD_CODENAMES[inner] ?? words(inner);
}

/** A recorded C.H.A.O.S. choice uses the same card codenames as Mastery. */
export function chaosChoice(code) {
  const match = /^([A-Za-z]+)([1-3])$/.exec(code);
  return match
    ? `${masteryCard("Mastery" + match[1])} · tier ${match[2]}`
    : code;
}

/** The badge as a player would say it. Never throws; an unknown shape
 *  comes back as its words, which is still better than the identifier. */
export function badgeLabel(name) {
  const id = String(name ?? "");
  if (!id) return id;
  const card = masteryCard(id);
  if (card) return `${card} Mastery`;
  if (BADGE_NAMES[id]) return BADGE_NAMES[id];
  // SeasonalBadge_202509, SeasonalBadge_202507_v2, MergeTacticsBadge_202506:
  // the month the badge is for, said as a month.
  const dated = /^([A-Za-z]+?)(?:Badge)?_(\d{4})(\d{2})(?:_v\d+)?$/.exec(id);
  if (dated) {
    const month = MONTHS[Number(dated[3]) - 1];
    const what = dated[1] === "Seasonal" ? "Season" : words(dated[1]);
    return month ? `${what} ${month} ${dated[2]}` : words(id);
  }
  // Crl20Wins2024, CrlSpectator2025, CrlChampion2024: the league's own
  // capitals. `_v2` and a trailing `Badge` are the API's, not a player's
  // (CrazyArenaBadge3 keeps its word: the digit is the badge's number).
  const bare = id.replace(/_v\d+$/, "").replace(/Badge$/, "");
  return versioned(
    id,
    words(bare)
      .replace(/^Crl\b/, "CRL")
      .replace(/^(\d{4}) Year$/, "$1 Year Badge"),
  );
}

/* ------------------------------------------------------------------ */
/* Which badge level-ups the timeline tells (the owner, 2026-11-17)    */
/* ------------------------------------------------------------------ */

/** A Mastery badge's rungs are its multiples of five and its top level:
 *  Mastery is the volume (one Trophy Road climb gave 74 level-ups in a
 *  week), and 5 and 10 are the levels a player names. */
export const MASTERY_RUNG = 5;

/** Badges whose level-ups the timeline never tells: each repeats a moment
 *  it already has (BattleWins: career_wins_step; CollectionLevel:
 *  collection_level_step), or is a ranking (LadderTop1000 and its
 *  tournament twin: the facts-only rule bans rankings). */
export const UNTOLD_BADGES = new Set([
  "BattleWins",
  "CollectionLevel",
  "LadderTop1000",
  "LadderTournamentTop1000",
]);

/** The 12-win challenge badges, by the challenge a player names. Their
 *  progress counts completed 12-win runs (tiers at 1 and 10 runs on one
 *  recorded profile), so a run is told by twelve_win_run, and the tier
 *  rides on that item rather than a badge_earned of its own. */
export const TWELVE_WIN_BADGES = {
  Classic12Wins: "Classic Challenge",
  Grand12Wins: "Grand Challenge",
};

export const isMasteryBadge = (name) => /^Mastery/.test(String(name ?? ""));

/**
 * The rung a badge's level-up crossed, or null when it crossed none: the
 * one rule the record writes (badge_earned's step, 0286) and the timeline
 * reads. A Mastery badge crosses the highest multiple of five, or its top
 * level, in (prior, level], so a jump from 3 to 6 crosses 5; any other
 * tiered badge's every level is a rung, its first level included; a badge
 * the timeline never tells crosses none.
 */
export function badgeRung({
  name,
  level,
  prior_level = null,
  max_level = null,
}) {
  if (typeof level !== "number") return null;
  if (UNTOLD_BADGES.has(name) || name in TWELVE_WIN_BADGES) return null;
  const prior = typeof prior_level === "number" ? prior_level : 0;
  if (level <= prior) return null;
  if (!isMasteryBadge(name)) return level;
  if (typeof max_level === "number" && level >= max_level && prior < max_level)
    return max_level;
  const rung = Math.floor(level / MASTERY_RUNG) * MASTERY_RUNG;
  return rung > prior && rung > 0 ? rung : null;
}
