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
  const { rows: claims } = await db.query(
    `select c.player_tag, cm.clan_tag, cm.role
     from claim c
     left join clan_membership cm
       on cm.player_tag = c.player_tag and cm.left_observed_at is null
     where c.account_id = $1`,
    [account.accountId],
  );
  const clanTags = [
    ...new Set(claims.filter((c) => c.clan_tag).map((c) => c.clan_tag)),
  ];
  // Clan scope requires the clan to be actively recorded.
  const recordedClans = clanTags.length
    ? (
        await db.query(
          `select subject_tag from recording
           where subject_type = 'clan' and status = 'active' and subject_tag = any($1)`,
          [clanTags],
        )
      ).rows.map((r) => r.subject_tag)
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
  };
}

/**
 * Resolve a subject tag. Universal reads: any valid tag resolves; the
 * 'need' parameter is retained for call-site compatibility but no longer
 * gates. Returns { tag, scope: 'own'|'public' }.
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
    const { rows } = await db.query(
      `select player_tag from claim where account_id = $1 and is_primary`,
      [account.accountId],
    );
    if (!rows[0]) {
      throw {
        code: "not_found",
        message: "No primary claimed tag on this account.",
        hint: "Claim a player tag on the website first.",
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
        hint: "elixir_watch_clan requests recording; recorded clans are readable by everyone.",
      };
    }
    return tag;
  }
  if (ent.clans.length === 0) {
    throw {
      code: "not_entitled",
      message: "No recorded clan membership on this account.",
      hint: "Clan tools cover recorded clans you are an open member of.",
    };
  }
  return ent.clans[0];
}
