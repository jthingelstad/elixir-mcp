/**
 * A battle's public link (2026-10-01, Jamie: "Public yes"). A battle_id
 * is a sha256 (64 hex), and its page lives at /battle/<short id>: the
 * id's first 12 characters, longer only when another recorded battle
 * shares them. The link is what mail, Ladder, Clan, the console and an
 * agent hand a person for one battle; `/battle/<short id>.png` is its
 * share picture.
 */
export const ELIXIR_ORIGIN = "https://elixir.poapkings.com";

/** The shortest a battle's short id ever is. */
export const BATTLE_SHORT_ID_MIN = 12;

const HEX = /^[0-9a-f]+$/;

/** The short id for a battle, given the length that makes it unique
 *  (`battleShortLength`); never under BATTLE_SHORT_ID_MIN. */
export function battleShortId(
  battleId: string,
  length: number = BATTLE_SHORT_ID_MIN,
): string {
  return battleId.slice(
    0,
    Math.max(BATTLE_SHORT_ID_MIN, Math.min(length, battleId.length)),
  );
}

/** The length of the shortest prefix that tells `battleId` apart from
 *  its neighbours in sorted order (the ids just below and above it);
 *  null neighbours mean none. */
export function battleShortLength(
  battleId: string,
  neighbours: Array<string | null | undefined>,
): number {
  let shared = 0;
  for (const other of neighbours) {
    if (!other) continue;
    let i = 0;
    while (i < battleId.length && battleId[i] === other[i]) i++;
    shared = Math.max(shared, i);
  }
  return Math.max(BATTLE_SHORT_ID_MIN, Math.min(shared + 1, battleId.length));
}

/** The page for a battle, by its short id. */
export function battleUrl(shortId: string): string {
  return `${ELIXIR_ORIGIN}/battle/${shortId}`;
}

/** The short id (or full id) a string names: a bare id of 12 to 64 hex
 *  characters, or a battle link (its `.png` too). Null when it is
 *  neither. */
export function parseBattleRef(ref: string): string | null {
  const s = String(ref).trim().toLowerCase();
  const m = /\/battle\/([0-9a-f]{12,64})(?:\.png)?\/?(?:[?#].*)?$/.exec(s);
  const id = m?.[1] ?? s;
  return id.length >= BATTLE_SHORT_ID_MIN && id.length <= 64 && HEX.test(id)
    ? id
    : null;
}
