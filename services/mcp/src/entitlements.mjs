/**
 * Entitlement rules — DESIGN §4.2, the whole policy:
 *  1. A claim entitles the account to FULL history for that tag.
 *  2. Clan cover: while P is an open member of recorded clan C, accounts
 *     claiming any member tag of C read C's clan-scoped data and
 *     SUMMARY-level stats of fellow members; battle-level history of a
 *     fellow member needs that member's share_battles_with_clan consent —
 *     except war battles, which are clan-readable by default.
 *  3. A battle is readable by anyone entitled to either participant.
 *  4. Leadership-sensitive analytics need the claimed tag to hold elder+
 *     in the recorded clan.
 *
 * INTERIM (2026-09-03, recorded in NOTES): rule 2 says verified claims;
 * liveness verification ships later in this build order and every current
 * claim is soft. Accounts are owner-approved, so soft claims count for
 * clan scope until verification exists — then CLAN_SCOPE_REQUIRES flips
 * to 'verified'.
 */

import { normalizeTag, InvalidTagError } from '@elixir-mcp/contracts';

export const CLAN_SCOPE_REQUIRES = 'unverified'; // -> 'verified' after liveness ships
const LEADERSHIP_ROLES = new Set(['elder', 'coLeader', 'leader']);

/** Everything the account can see, resolved once per request. */
export async function resolveEntitlements(db, account) {
  const { rows: claims } = await db.query(
    `select c.player_tag, c.status, c.share_battles_with_clan,
            cm.clan_tag, cm.role
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
      if (!best || (LEADERSHIP_ROLES.has(c.role) && !LEADERSHIP_ROLES.has(best))) {
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
    for (const c of clans) if (!roles.has(c)) roles.set(c, 'leader');
  }

  return {
    ownTags: claims.map((c) => c.player_tag),
    clans,
    roles, // clan_tag -> best role among claimed member tags (owner: leader)
  };
}

/**
 * Resolve a subject tag against a need:
 *  - 'full': own claims only (rule 1);
 *  - 'summary': own claims OR open members of an entitled clan (rule 2);
 *  - 'battles': like summary, but reports whether battle-level access is
 *    unrestricted ('all': own or consented) or war-only.
 * Returns { tag, scope: 'own'|'clanmate', battles: 'all'|'war_only' }.
 * Throws {code} objects matching the closed error taxonomy.
 */
export async function resolveSubject(db, account, inputTag, need = 'full') {
  const ent = await resolveEntitlements(db, account);
  let tag;
  if (inputTag === undefined || inputTag === null || inputTag === '') {
    const { rows } = await db.query(
      `select player_tag from claim where account_id = $1 and is_primary`,
      [account.accountId],
    );
    if (!rows[0]) {
      throw { code: 'not_found', message: 'No primary claimed tag on this account.', hint: 'Claim a player tag on the website first.' };
    }
    tag = rows[0].player_tag;
  } else {
    try {
      tag = normalizeTag(String(inputTag));
    } catch (err) {
      if (err instanceof InvalidTagError) throw { code: 'invalid_tag', message: err.message };
      throw err;
    }
  }

  if (ent.ownTags.includes(tag)) return { tag, scope: 'own', battles: 'all' };
  if (need === 'full') {
    throw { code: 'not_entitled', message: `No claim on ${tag} for this account.` };
  }

  // Fellow member of an entitled clan?
  const { rows: membership } = await db.query(
    `select cm.clan_tag, c.share_battles_with_clan
     from clan_membership cm
     left join claim c on c.player_tag = cm.player_tag
     where cm.player_tag = $1 and cm.left_observed_at is null and cm.clan_tag = any($2)`,
    [tag, ent.clans.length ? ent.clans : ['#NONE']],
  );
  if (!membership[0]) {
    throw {
      code: 'not_entitled',
      message: `${tag} is not a fellow member of a clan you belong to.`,
      hint: 'Clan-scoped reads cover open members of your recorded clan.',
    };
  }
  const consented = membership.some((m) => m.share_battles_with_clan === true);
  return { tag, scope: 'clanmate', battles: consented ? 'all' : 'war_only' };
}

/** Rule 4: leadership analytics gate. */
export async function requireLeadership(db, account, clanTag) {
  const ent = await resolveEntitlements(db, account);
  const role = ent.roles.get(clanTag);
  if (!role || !LEADERSHIP_ROLES.has(role)) {
    throw {
      code: 'not_entitled',
      message: 'Leadership-scoped data needs an elder or higher claimed tag in this clan.',
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
      throw { code: 'invalid_tag', message: `Invalid clan tag: ${inputTag}` };
    }
    if (!ent.clans.includes(tag)) {
      throw { code: 'not_entitled', message: `${tag} is not a recorded clan you belong to.` };
    }
    return tag;
  }
  if (ent.clans.length === 0) {
    throw {
      code: 'not_entitled',
      message: 'No recorded clan membership on this account.',
      hint: 'Clan tools cover recorded clans you are an open member of.',
    };
  }
  return ent.clans[0];
}
