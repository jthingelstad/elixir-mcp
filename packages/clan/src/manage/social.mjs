/**
 * Social (Jamie, 2026-09-26): the clan's own section, starting with the
 * clan map. A member says where they play from (a country, its region and,
 * if they like, a city, picked from the lists: never an address, never the
 * device's location) and sees where the rest of the clan is, with each
 * one's local time.
 *
 * The rules, as decided:
 * - Only verified members of that clan, signed in, see its map; leaders
 *   see exactly what members see, names beside pins.
 * - Off until a member adds themselves; they can remove it any time;
 *   nobody places or edits anyone else, leaders included.
 * - One place per person: written under each of their verified tags, so it
 *   shows in every clan they are in. Someone no longer on a clan's roster
 *   is gone from its map at once (the map is drawn from today's roster).
 * - Social features are the clan's alone: nothing here goes to Elixir as a
 *   fact, and the clan's agent never sees it.
 * - Every clan has it, with or without a policy and at any size; a leader
 *   or co-leader can turn the clan's social features off.
 * - The player map and Near you (#768, Jamie 2026-11-14): a place also
 *   reaches every signed-in Elixir member there only when its owner chose
 *   it (`player_map: true`). A place saved before that choice existed has
 *   no `player_map` and stays on clan maps only until its owner says yes;
 *   a save that does not say (an older page) never widens it: it keeps a
 *   no, and is otherwise clan maps only, never an earlier yes (the newest
 *   row under a tag may be a former owner's, whose yes is not this
 *   person's). The
 *   readers are Elixir's (`@elixir-mcp/auth/clan-context`), not Clan's.
 * - A place belongs to the claim that wrote it (2026-11-14): every save
 *   stamps the writer's account, and every read here (your place, the
 *   picker, the clan map) goes through `ownedPlaces`, Elixir's one rule
 *   (`readOwnedPlaces`): a row under a tag whose verified claim another
 *   account now holds, or that ended, is no place. A tag that moves never
 *   shows its former owner's place to its new owner or on a clan map.
 */

import { ManageError } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);

/**
 * `ownedPlaces(tags)` reads the places their current verified claims wrote
 * (`readOwnedPlaces` over the request's client); `accountId` is the
 * signed-in person's, stamped on every place they save.
 */
export function createSocialService({
  ledger,
  geo,
  ownedPlaces,
  accountId,
  now = () => Date.now(),
}) {
  if (typeof ownedPlaces !== "function")
    throw new Error("createSocialService needs ownedPlaces");
  async function setting(clanTag) {
    const s = await ledger.socialSetting(clanTag);
    return {
      enabled: s?.enabled !== false,
      set_by_name: s?.set_by_name ?? null,
      set_at: s?.set_at ?? null,
    };
  }

  /** The newest place among a person's tags that they wrote (they are
   *  written together; a tag verified later has none until the next save). */
  async function newestRow(tags) {
    const rows = await ownedPlaces(tags);
    if (!rows.length) return null;
    return rows.sort((a, b) =>
      String(b.set_at).localeCompare(String(a.set_at)),
    )[0];
  }

  /** Whether a place is on the player map: true, false (its owner chose
   *  clan maps only) or null (saved before the choice existed: clan maps
   *  only, and its owner has not been asked). */
  const playerMapOf = (row) =>
    typeof row?.player_map === "boolean" ? row.player_map : null;

  async function placeOf(tags) {
    const row = await newestRow(tags);
    if (!row) return null;
    const resolved = await geo.resolve(row);
    return resolved.error
      ? null
      : { ...resolved, set_at: row.set_at, player_map: playerMapOf(row) };
  }

  /** One place under each of the person's verified tags, written now and
   *  stamped with their account: the row is theirs, and no other claim on
   *  the tag reads it as a place. */
  async function write(tags, place, playerMap) {
    if (!accountId) throw new Error("a place is saved by a signed-in account");
    await ledger.savePlace(tags, {
      account_id: accountId,
      country: place.country,
      region: place.region,
      city: place.city,
      set_at: new Date(now()).toISOString(),
      ...(playerMap === null ? {} : { player_map: playerMap }),
    });
  }

  return {
    setting,
    enabled: async (clanTag) => (await setting(clanTag)).enabled,

    /** A leader or co-leader turns the clan's social features on or off. */
    async setEnabled(clanTag, who, enabled) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      if (typeof enabled !== "boolean")
        throw new ManageError(400, "bad_request", "enabled is true or false");
      await ledger.saveSocialSetting(clanTag, {
        enabled,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: new Date(now()).toISOString(),
      });
      return setting(clanTag);
    },

    /** The person's own place (any of their verified tags), or null. */
    myPlace: (person) => placeOf(person.tags),

    /** Save a place. `player_map` is the person's choice. Left out (a page
     *  that does not ask), it never widens who sees the place: a no stays
     *  a no and anything else is clan maps only. A yes is never carried
     *  over (Codex on #1054); the row read is the person's own place
     *  (`ownedPlaces`), never a former owner's. */
    async setMyPlace(person, input) {
      const asked = input?.player_map;
      if (asked !== undefined && asked !== null && typeof asked !== "boolean")
        throw new ManageError(
          400,
          "bad_request",
          "player_map is true or false",
        );
      const place = await geo.resolve(input);
      if (place.error)
        throw new ManageError(400, "bad_place", place.error, {
          field: place.field,
          message: place.error,
        });
      const playerMap =
        typeof asked === "boolean"
          ? asked
          : playerMapOf(await newestRow(person.tags)) === false
            ? false
            : null;
      await write(person.tags, place, playerMap);
      return { ...place, player_map: playerMap };
    },

    /** Join or leave the player map and Near you, keeping the place. */
    async setPlayerMap(person, input) {
      if (typeof input?.player_map !== "boolean")
        throw new ManageError(
          400,
          "bad_request",
          "player_map is true or false",
        );
      const row = await newestRow(person.tags);
      if (!row) throw new ManageError(404, "no_place", "Set a place first.");
      const place = await geo.resolve(row);
      if (place.error)
        throw new ManageError(404, "no_place", "Set a place first.");
      await write(person.tags, place, input.player_map);
      return { ...place, player_map: input.player_map };
    },

    async clearMyPlace(person) {
      await ledger.removePlaces(person.tags);
      return { cleared: true };
    },

    /**
     * The clan's map: today's roster members who have added a place, each
     * with their pin and time zone, and yours. `members` is the roster as
     * the clan page reads it.
     */
    async map(clanTag, members, you) {
      if (!(await setting(clanTag)).enabled)
        throw new ManageError(409, "social_off");
      const rows = await ownedPlaces(members.map((m) => m.player_tag));
      const byTag = new Map(rows.map((r) => [r.player_tag, r]));
      const entries = [];
      for (const m of members) {
        const row = byTag.get(m.player_tag);
        if (!row) continue;
        const place = await geo.resolve(row);
        if (place.error) continue;
        entries.push({
          player_tag: m.player_tag,
          name: m.name ?? null,
          role: m.role ?? null,
          role_label: m.role_label ?? null,
          you: you.tags.includes(m.player_tag),
          place,
        });
      }
      return {
        clan_tag: clanTag,
        members: members.length,
        on_map: entries.length,
        entries,
        yours: await placeOf(you.tags),
        attribution:
          "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.",
      };
    },
  };
}
