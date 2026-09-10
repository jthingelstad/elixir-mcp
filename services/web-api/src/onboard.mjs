/**
 * What an approved account already asked for.
 *
 * Every access request carries a player tag — it is the second field on the
 * form and the thing an approval is largely judged on — and until now nothing
 * read it after the decision. The new arrival signed in to an empty console
 * and was asked to type in the tag they had already given us, with the
 * recorder not yet pointed at them, which is the one moment the product has
 * to feel like it was expecting you.
 *
 * So approval claims the player and tracks their clan at ACTIVITY scope. That
 * is not a favour taken out of their allowance by surprise: every tier has
 * exactly one activity clan slot, and this is what it is for. Comprehensive
 * (which also records every member's battles) stays a choice they make.
 *
 * Idempotent, and it never overrides a decision the holder has made: it adds
 * a claim only when the account has none, and a clan only when the account
 * tracks none. account.onboarded_at stops it running forever — see 0065 for
 * why the clan half needs a second chance at first sign-in.
 */
import { addPlayer } from "@elixir-mcp/claims";
// Same import path the clan route uses: recording lives with the MCP
// tools, and there is one implementation of "start recording a clan".
import { ensureClanRecording } from "../../mcp/src/tools.mjs";

/** The clan we believe this player is in, or null if we do not know yet. */
async function clanOf(db, playerTag) {
  const { rows } = await db.query(
    `select coalesce(cm.clan_tag, p.last_known_clan_tag) as clan_tag,
            (p.player_tag is not null) as observed
     from player p
     left join clan_membership cm on cm.player_tag = p.player_tag
       and cm.left_observed_at is null
     where p.player_tag = $1
     limit 1`,
    [playerTag],
  );
  return { clanTag: rows[0]?.clan_tag ?? null, observed: Boolean(rows[0]) };
}

/**
 * Run the approval-time tracking for one account. Safe to call on any
 * sign-in: it returns immediately once the stamp is set.
 *
 * Returns what it did, for the caller's log — never throws into the
 * caller's path, because failing to pre-populate a console must not fail
 * an approval or a sign-in.
 */
export async function onboardAccount(db, accountId) {
  try {
    const { rows } = await db.query(
      `select requested_player_tag, status, kind, onboarded_at
       from account where account_id = $1`,
      [accountId],
    );
    const acct = rows[0];
    if (!acct || acct.onboarded_at) return { skipped: "already" };
    if (acct.status !== "approved") return { skipped: "not_approved" };
    // An agent or integration has no self to claim a player with.
    if (acct.kind && acct.kind !== "person") return { skipped: "not_person" };

    const tag = acct.requested_player_tag;
    if (!tag) {
      await db.query(
        `update account set onboarded_at = now() where account_id = $1`,
        [accountId],
      );
      return { skipped: "no_requested_tag" };
    }

    const done = { player: false, clan: null };

    // The player, only if they have not started building their own list.
    const { rows: claims } = await db.query(
      `select 1 from claim where account_id = $1 limit 1`,
      [accountId],
    );
    if (claims.length === 0) {
      const added = await addPlayer(
        db,
        { accountId },
        { tag, makePrimary: true, via: "approval" },
      );
      done.player = added.ok === true;
    }

    // The clan, only if they track none. Unknown clan leaves the stamp
    // unset so the next sign-in tries again once the player is fetched.
    const { rows: clans } = await db.query(
      `select 1 from account_clan where account_id = $1 limit 1`,
      [accountId],
    );
    const { clanTag, observed } = await clanOf(db, tag);
    if (clans.length === 0 && clanTag) {
      await db.query(
        `insert into clan (clan_tag) values ($1) on conflict do nothing`,
        [clanTag],
      );
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope)
         values ($1, $2, 'activity')
         on conflict (account_id, clan_tag) do nothing`,
        [accountId, clanTag],
      );
      await ensureClanRecording(db, clanTag, accountId);
      done.clan = clanTag;
    }

    // Finished when there is nothing left that a later fetch could tell
    // us: the clan is tracked, or they already had clans of their own, or
    // we have seen the player and they are in none.
    if (done.clan || clans.length > 0 || (observed && !clanTag)) {
      await db.query(
        `update account set onboarded_at = now() where account_id = $1`,
        [accountId],
      );
    }
    return done;
  } catch (err) {
    // Pre-populating a console is a courtesy; an approval is not.
    console.error("onboard_failed", accountId, err?.message);
    return { error: err?.message ?? "failed" };
  }
}
