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
    `select c.player_tag, c.is_primary, cm.clan_tag, cm.role
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

  // AN AGENT'S CLAN IS NOT A CLAIM.
  //
  // A person's clans come from the players they claimed. An agent holds no
  // claims at all — a claim asserts "this player is me" and an agent has no
  // self — so the query above returns nothing for every agent, and the promise
  // `initialize` makes in writing ("OMIT clan_tag to mean it") answered
  // "No recorded clan membership on this account" instead. The subject was
  // there the whole time, in account_clan: the same row describeIdentity reads
  // to say YOU ACT FOR. This resolver was the one agent-aware path that never
  // learned about it (0053 added the kind; this is the reader it missed).
  //
  // is_primary first, so the clan a tool defaults to is the clan the
  // connection was told at initialize that it acts for. A clan family must not
  // disagree with its own opening instructions.
  //
  // `roles` is deliberately NOT extended: leadership analytics still need an
  // elder-or-higher CLAIMED tag, and whether a clan's agent inherits that is a
  // product decision, not a side effect of fixing a default.
  const agentClans =
    (account.kind ?? "person") === "agent"
      ? (
          await db.query(
            `select ac.clan_tag from account_clan ac
             join recording r
               on r.subject_type = 'clan'
              and r.subject_tag = ac.clan_tag
              and r.status = 'active'
             where ac.account_id = $1
             order by ac.is_primary desc, ac.clan_tag`,
            [account.accountId],
          )
        ).rows.map((r) => r.clan_tag)
      : [];

  // The instance owner administers every recorded clan (Jamie, 2026-09-03:
  // owner-enrolled clans the owner may not be a member of). Rule 2 for
  // everyone else still requires open membership; member battle-level
  // consent applies to the owner at the tool layer like anyone else.
  let clans = [...new Set([...agentClans, ...recordedClans])];
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
/**
 * Who "me" is for this caller, without a round trip.
 *
 * Three ways a subject gets chosen, in strict precedence:
 *
 *   1. an explicit tag             — always wins, nothing else is consulted
 *   2. on_behalf_of                — the agent naming WHICH human is asking
 *   3. the caller's primary claim  — a person's own default
 *
 * (2) exists because an agent serves many humans through one connection and
 * MCP carries no per-request end-user identity. The id is whatever the
 * connecting surface has and is opaque to us; the mapping is per account and
 * confers nothing, since recorded reads are universal either way.
 *
 * An agent has no primary claim, so for an agent (2) is the only route to a
 * default — and its absence is a question to ask the human, not an error to
 * paper over.
 */
async function identityFor(db, accountId, externalId) {
  if (typeof externalId !== "string" || !externalId.trim()) return null;
  const { rows } = await db.query(
    `select player_tag from agent_identity
     where account_id = $1 and external_id = $2`,
    [accountId, externalId.trim()],
  );
  return rows[0]?.player_tag ?? null;
}

export async function resolveSubject(
  db,
  account,
  inputTag,
  _need = "full",
  { onBehalfOf = null } = {},
) {
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
    const mapped = await identityFor(db, account.accountId, onBehalfOf);
    if (mapped) {
      tag = mapped;
    } else if ((account.kind ?? "person") !== "person") {
      // An agent has no self to fall back on. Say what would fix it rather
      // than guessing a member of the clan, which would be confidently wrong.
      throw {
        code: "not_found",
        message: onBehalfOf
          ? `No player is mapped to ${onBehalfOf} yet.`
          : "This connection acts for a clan, so there is no default player.",
        hint: "Ask who they are in the clan, then call elixir_identify to remember it. Or pass player_tag explicitly.",
      };
    } else {
      // Still is_primary, not relationship: 0055 is the EXPAND half, and
      // forty-odd readers plus every test fixture still write the boolean.
      // relationship carries the new information (alt / friend / watching);
      // a contract migration switches the reads and drops the column once
      // nothing sets it. Writers set both, so they cannot disagree.
      const { rows } = await db.query(
        `select player_tag from claim where account_id = $1 and is_primary`,
        [account.accountId],
      );
      if (!rows[0]) {
        throw {
          code: "not_found",
          message: "No primary player on this account.",
          hint: "Add a player with elixir_add_player; your first one becomes your primary.",
        };
      }
      tag = rows[0].player_tag;
    }
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
    // Two ways to have no default, and they need different next steps: a
    // person joins or claims a tag, an agent needs a recorded clan on the
    // agent itself. Telling an agent to be "an open member" of something is
    // advice it can never act on.
    const isAgent = (account.kind ?? "person") === "agent";
    throw {
      code: "not_entitled",
      message: isAgent
        ? "This agent has no recorded clan."
        : "No recorded clan membership on this account.",
      hint: isAgent
        ? "An agent's clan is set on the agent (Account -> Agents) and must be actively recorded."
        : "Clan tools cover recorded clans you are an open member of.",
    };
  }
  return ent.clans[0];
}
