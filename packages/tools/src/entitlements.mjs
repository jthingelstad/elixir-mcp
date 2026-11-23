/**
 * Access policy — UNIVERSAL READS (Jamie, 2026-09-05):
 *  1. All recorded GAME data — players, battles, clans, war — is readable
 *     by every approved account. The RoyaleAPI posture: the underlying
 *     API is public and unrestricted; once a player is in the data, they
 *     are in the data. This superseded the launch-era claims/clanmate
 *     read gating (and the 2026-09-03 clan-sharing rule on the way).
 *  2. ACCOUNT data stays private: claims, watches, quotas, feedback,
 *     usage — yours only.
 *  3. Leadership-sensitive analytics still need an elder+ claimed tag in
 *     the recorded clan (requireLeadership).
 *  4. 'own' scope still marks the caller's claimed tags for tools that
 *     personalize; defaults (no tag given) resolve to the primary claim.
 *
 * Claims are TRUST-BASED (Jamie, 2026-09-03): accounts are owner-approved
 * and a claim is taken at its word.
 */

import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";

const LEADERSHIP_ROLES = new Set(["elder", "coLeader", "leader"]);

/** Everything the account can see, resolved once per request. */
async function resolveEntitlements(db, account) {
  // Primary player FIRST. A person's clans come from the players they
  // claimed, and this had no ORDER BY at all, so ent.clans[0] - what an
  // omitted clan_tag means - was whatever order the rows arrived in. On an
  // account with a primary in one clan and an alt in another, the default
  // and the "Your clan is X" sentence could both point somewhere the
  // primary player does not play (playtest round, 2026-09-09).
  const { rows: claims } = await db.query(
    `select c.player_tag, c.is_primary, c.relationship, cm.clan_tag, cm.role
     from claim c
     left join clan_membership cm
       on cm.player_tag = c.player_tag and cm.left_observed_at is null
     where c.account_id = $1
     order by c.is_primary desc, c.player_tag`,
    [account.accountId],
  );
  const clanTags = [
    ...new Set(claims.filter((c) => c.clan_tag).map((c) => c.clan_tag)),
  ];
  // Clan scope requires the clan to be actively recorded.
  // Filtered THROUGH clanTags rather than taken in the row order the
  // recording table happens to return, so the primary-first order above
  // survives the recorded-clan check.
  const recordedClans = clanTags.length
    ? await (async () => {
        const { rows } = await db.query(
          `select subject_tag from recording
           where subject_type = 'clan' and status = 'active' and subject_tag = any($1)`,
          [clanTags],
        );
        const active = new Set(rows.map((r) => r.subject_tag));
        return clanTags.filter((t) => active.has(t));
      })()
    : [];
  const roles = new Map();
  for (const c of claims) {
    if (c.clan_tag && recordedClans.includes(c.clan_tag)) {
      const best = roles.get(c.clan_tag);
      if (
        !best ||
        (LEADERSHIP_ROLES.has(c.role) && !LEADERSHIP_ROLES.has(best))
      ) {
        roles.set(c.clan_tag, c.role);
      }
    }
  }

  // The instance owner administers every recorded clan (Jamie, 2026-09-03:
  // owner-enrolled clans the owner may not be a member of). Rule 2 for
  // everyone else still requires open membership; member battle-level
  // consent applies to the owner at the tool layer like anyone else.
  let clans = recordedClans;
  if (account.isOwner) {
    const { rows } = await db.query(
      `select subject_tag from recording where subject_type = 'clan' and status = 'active'`,
    );
    clans = [...new Set([...recordedClans, ...rows.map((r) => r.subject_tag)])];
    for (const c of clans) if (!roles.has(c)) roles.set(c, "leader");
  }

  return {
    ownTags: claims.map((c) => c.player_tag),
    clans,
    roles, // clan_tag -> best role among claimed member tags (owner: leader)
    // The primary player's current clan, recorded or not (3.18.0): what
    // an omitted clan_tag means on a person's door, so the default agrees
    // with the "Your clan is" sentence and never slides to an alt's.
    primaryClan: claims.find((c) => c.is_primary)?.clan_tag ?? null,
    // The recorded clans of the person's ALTS only: the other players who
    // are also them. A friend's clan is never
    // offered as "yours" (DECISIONS: refuse rather than choose).
    altClans: [
      ...new Set(
        claims
          .filter(
            (c) =>
              !c.is_primary &&
              c.relationship === "alt" &&
              c.clan_tag &&
              recordedClans.includes(c.clan_tag),
          )
          .map((c) => c.clan_tag),
      ),
    ],
  };
}

/**
 * Resolve a subject tag. Universal reads: any valid tag resolves; the
 * 'need' parameter is retained for call-site compatibility but no longer
 * gates. An explicit tag always wins; an omitted one is the caller's
 * primary player. Returns { tag, scope: 'own'|'public' }.
 * Throws {code} objects matching the closed error taxonomy.
 */
export async function resolveSubject(db, account, inputTag, _need = "full") {
  const ent = await resolveEntitlements(db, account);
  let tag;
  // Empty string is a CALLER BUG (an unset variable), not "use my
  // default" — silently resolving it would hand back the wrong player's
  // data with zero signal (round-3 adversarial finding).
  if (typeof inputTag === "string" && inputTag.trim() === "") {
    throw {
      code: "invalid_tag",
      message: "player_tag is an empty string.",
      hint: "Omit the argument entirely to use your primary claimed tag.",
    };
  }
  if (inputTag === undefined || inputTag === null) {
    // Still is_primary, not relationship: 0055 is the EXPAND half, and
    // forty-odd readers plus every test fixture still write the boolean.
    // relationship carries the new information (alt / friend);
    // a contract migration switches the reads and drops the column once
    // nothing sets it. Writers set both, so they cannot disagree.
    const { rows } = await db.query(
      `select player_tag from claim where account_id = $1 and is_primary`,
      [account.accountId],
    );
    if (!rows[0]) {
      throw {
        code: "no_subject",
        message: "No primary player on this account.",
        hint: "elixir_follow_player({ player_tag }) follows one; your first becomes your primary.",
      };
    }
    tag = rows[0].player_tag;
  } else {
    try {
      tag = normalizeTag(String(inputTag));
    } catch (err) {
      if (err instanceof InvalidTagError)
        throw { code: "invalid_tag", message: err.message };
      throw err;
    }
  }

  if (ent.ownTags.includes(tag)) return { tag, scope: "own" };
  // UNIVERSAL READS (Jamie, 2026-09-05): all recorded game data is
  // readable by every approved account — the RoyaleAPI posture. The
  // underlying API is public and unrestricted; once a player is in the
  // data, they are in the data. This supersedes the launch-era
  // claims/clanmate read gating (the 2026-09-03 clan-sharing rule was a
  // step on the way here). Account-scoped things (claims, watches,
  // quotas, feedback) remain private; 'own' scope still marks the
  // caller's own tags for tools that care.
  return { tag, scope: "public" };
}

/** Rule 4: leadership analytics gate. */
export async function requireLeadership(db, account, clanTag) {
  const ent = await resolveEntitlements(db, account);
  const role = ent.roles.get(clanTag);
  if (!role || !LEADERSHIP_ROLES.has(role)) {
    throw {
      code: "not_entitled",
      message:
        "Leadership-scoped data needs an elder or higher claimed tag in this clan.",
    };
  }
  return role;
}

/** Default clan for clan tools: the caller's (sole) entitled clan. */
export async function resolveEntitledClan(db, account, inputTag) {
  const ent = await resolveEntitlements(db, account);
  if (inputTag) {
    let tag;
    try {
      tag = normalizeTag(String(inputTag));
    } catch {
      throw { code: "invalid_tag", message: `Invalid clan tag: ${inputTag}` };
    }
    // Universal reads (2026-09-05): any actively recorded clan is
    // readable by every approved account.
    const { rows } = await db.query(
      `select 1 from recording
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
      [tag],
    );
    if (!rows[0]) {
      throw {
        code: "not_recorded",
        message: `${tag} is not a recorded clan.`,
        hint: "Pass live: true on clans_roster or war_current for a fresh read (queued and answered from the record if none is in hand), or elixir_follow_clan({ clan_tag }) to start recording it. Recorded clans are readable by everyone.",
      };
    }
    return tag;
  }
  // The default is the PRIMARY player's clan and nothing else (3.18.0;
  // DECISIONS "refuse rather than choose", 2026-09-25): never an alt's or
  // a friend's clan, for the owner too.
  const alts = ent.altClans.length
    ? ` (your alts' recorded clans: ${ent.altClans.join(", ")})`
    : "";
  if (!ent.primaryClan)
    throw {
      code: "no_subject",
      message:
        "Your primary player is not in a clan (or you have none), so nothing defaults to a clan.",
      hint: `Pass clan_tag explicitly${alts}; any recorded clan works.`,
    };
  if (!ent.clans.includes(ent.primaryClan))
    throw {
      code: "not_recorded",
      message: `Your primary player's clan ${ent.primaryClan} is not recorded, so nothing defaults to it.`,
      hint: `elixir_follow_clan({ clan_tag: "${ent.primaryClan}" }) records it; or pass clan_tag explicitly${alts}.`,
    };
  return ent.primaryClan;
}
