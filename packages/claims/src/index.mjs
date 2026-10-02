export { createPrincipal, normalizePrincipalName } from "./principals.mjs";
import {
  poolLimits,
  poolOwner,
  pooledClanWidth,
  pooledUsage,
  scopeWidth,
  widthScope,
} from "./pool.mjs";

export { poolLimits, poolOwner, pooledUsage } from "./pool.mjs";

/**
 * Who is subscribed to what, and therefore what gets recorded.
 *
 * Direct player claims and clan follows sustain recording.
 *
 * Adding and removing a player, for BOTH entry points.
 *
 * The MCP tool and the website route each carried their own copy of this
 * logic, and the copies drifted into the same three bugs (#8, #9, #10).
 * There is one copy now; the callers translate the result into their own
 * error shape and nothing else.
 *
 * Every mutation runs in ONE transaction that starts by locking the
 * account row. That lock is what makes the slot limit real: the capacity
 * check and the insert used to be separate autocommit statements, so
 * concurrent adds all read the same free capacity and every one of them
 * succeeded (#10).
 */

/** Serialize every claim mutation for one account behind its own row. */
async function lockAccount(db, accountId) {
  const { rows } = await db.query(
    `select account_id, role, is_owner, kind, max_player_recordings as override
     from account where account_id = $1 for update`,
    [accountId],
  );
  return rows[0] ?? null;
}

/**
 * Serialize every mutation touching ONE subject, across all accounts.
 *
 * The account lock protects the slot count, which is per account. The
 * recording and its subscriber count are per TAG and shared by everyone
 * watching it, so account locks alone leave two accounts free to decide
 * its fate simultaneously (#12). Two interleavings both broke:
 *
 *   A removes its last claim and stops the recording; B adds the same
 *   player, cannot see A's uncommitted stop, finds an active recording
 *   and creates none. Both commit: one subscriber, nothing recorded.
 *
 *   A and B each remove their claim; each still sees the other's
 *   uncommitted claim and declines to stop. Both commit: no
 *   subscribers, recording still running.
 *
 * ALWAYS TAKEN AFTER the account lock. Every mutation here touches at
 * most one account and one subject, so one fixed order is enough to
 * rule out a deadlock cycle - do not reverse it in a new caller.
 */
async function lockSubject(db, tag) {
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [tag]);
}

async function logEvent(db, accountId, kind, detail) {
  await db.query(
    `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
    [accountId, kind, JSON.stringify(detail)],
  );
}

/**
 * Make the recording match the reasons to record.
 *
 * A subject is recorded while ANY reason holds: an account claims the player or
 * follows the clan. When the last one goes, the recording stops.
 * An ops recording is never touched - it exists precisely because
 * somebody decided to record a subject nobody subscribes to.
 *
 * Callers must already hold the subject lock.
 */
export async function reconcileRecording(
  db,
  subjectType,
  tag,
  requestedBy,
  { dryRun = false } = {},
) {
  const { rows } = await db.query(
    `select
       -- EVERY reason a subject is recorded, counted in one place. An
       -- account associates with a player through claim and with a clan
       -- through account_clan. Retired Collections and boards do not count.
       ($2 = 'player'
        and exists (select 1 from claim where player_tag = $1)) as claimed,
       ($2 = 'clan'
        and exists (select 1 from account_clan where clan_tag = $1)) as added,
       ($2 = 'clan'
        and exists (select 1 from account_clan
                    where clan_tag = $1 and scope = 'comprehensive')) as added_deep,
       exists (select 1 from recording
               where subject_type = $2 and subject_tag = $1
                 and status = 'active' and origin = 'ops') as ops,
       exists (select 1 from recording
               where subject_type = $2 and subject_tag = $1
                 and status = 'active') as active`,
    [tag, subjectType],
  );
  const { claimed, added, added_deep, ops, active } = rows[0];
  const wanted = claimed || added;
  // A claim means somebody added this player to their account, which has
  // always meant full capture. A clan carries the depth each account
  // asked for. Widest retained reason wins.
  const scope = claimed || added_deep ? "comprehensive" : "activity";

  if (dryRun)
    return {
      started: wanted && !active && !ops,
      stopped: !wanted && active && !ops,
      retained: wanted || ops,
    };
  if (ops) return { started: false, stopped: false };

  if (wanted && !active) {
    if (subjectType === "player") {
      await db.query(
        `insert into player (player_tag) values ($1) on conflict do nothing`,
        [tag],
      );
    }
    // The direct subscription belongs to its requester.
    // The owner remains the fallback requester when no account is supplied.
    const origin = "claim";
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin, scope)
       values ($2, $1,
               coalesce($3::uuid, (select account_id from account where is_owner limit 1)),
               $4, $5)`,
      [tag, subjectType, requestedBy ?? null, origin, scope],
    );
    return { started: true, stopped: false };
  }
  if (wanted && active) {
    if (subjectType === "clan") {
      // Clans settle to the widest remaining reason, up or down: the
      // ratified rule is that a clan is recorded at the widest scope
      // anybody still asks for (docs/NOTES.md, added = recorded).
      await db.query(
        `update recording set scope = $3
         where subject_type = $2 and subject_tag = $1
           and status = 'active' and scope <> $3`,
        [tag, subjectType, scope],
      );
    } else if (scope === "comprehensive") {
      // A direct player follow always asks for comprehensive capture.
      await db.query(
        `update recording set scope = 'comprehensive'
         where subject_type = $2 and subject_tag = $1
           and status = 'active' and scope = 'activity'`,
        [tag, subjectType],
      );
    }
  }
  if (!wanted && active) {
    const { rowCount } = await db.query(
      `update recording set status = 'stopped'
       where subject_type = $2 and subject_tag = $1
         and status = 'active' and origin <> 'ops'`,
      [tag, subjectType],
    );
    return { started: false, stopped: rowCount > 0 };
  }
  return { started: false, stopped: false };
}

/**
 * Add (subscribe to) a player.
 *
 * Returns {ok:false, error:"quota_exceeded", limit, role} or
 * {ok:true, added, isPrimary, recordingStarted}. `added` is false on a
 * re-add, which stays idempotent.
 */
export async function addPlayer(
  db,
  account,
  { tag, makePrimary, via, relationship = null },
) {
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    if (!acct) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }

    // An integration has no self at all. An agent tracks players (Jamie,
    // 2026-09-23: "a randomly tracked account", a rival's star), but never
    // as "me": a claim's primary/alt say "this player is me", and an agent
    // acts FOR a clan, so every tool that defaults to "your tag" would
    // start answering for a bot. Its players are watched, only.
    const agent = acct.kind === "agent";
    if (acct.kind && acct.kind !== "person" && !agent) {
      await db.query("rollback");
      return { ok: false, error: "not_entitled", kind: acct.kind };
    }
    if (
      agent &&
      (makePrimary === true || (relationship && relationship !== "watching"))
    ) {
      await db.query("rollback");
      return { ok: false, error: "not_entitled", kind: "agent" };
    }

    // Slots are the person's, pooled across them and their agents: the
    // owner's row is the pool's lock, so two of them adding at once cannot
    // both take the last slot. Account, then owner, then subject, always.
    const owner = await poolOwner(db, account.accountId);
    if (owner.account_id !== account.accountId)
      await lockAccount(db, owner.account_id);
    await lockSubject(db, tag);
    const limits = poolLimits(owner);
    if (!limits.exempt) {
      const used = await pooledUsage(db, owner.account_id, {
        exceptPlayer: tag,
      });
      if (used.players_used >= limits.player_slots) {
        await db.query("rollback");
        return {
          ok: false,
          error: "quota_exceeded",
          limit: limits.player_slots,
          role: owner.role ?? "member",
        };
      }
    }

    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );

    const { rows: counted } = await db.query(
      `select count(*)::int as n from claim where account_id = $1`,
      [account.accountId],
    );
    // A person's first player is them; an agent never has a primary.
    const first = counted[0].n === 0 && !agent;
    const wantPrimary = !agent && (makePrimary === true || first);

    // Clear the old primary BEFORE inserting the new one. Inserting a
    // second is_primary row first is what tripped the partial unique
    // index, so the switch never happened and the whole add failed (#8).
    if (wantPrimary) {
      await db.query(
        // Both columns demote together. Clearing only the boolean left the old
        // primary carrying relationship='primary', and 0055's unique index on
        // that column then refused the new one -- the exact shape of #8, one
        // migration later.
        `update claim set is_primary = false,
                relationship = case when relationship = 'primary' then 'watching'
                                    else relationship end
         where account_id = $1 and is_primary and player_tag <> $2`,
        [account.accountId, tag],
      );
    }

    const { rowCount: claimed } = await db.query(
      // Both columns, always together: 0055's expand window means is_primary
      // is still the read path while relationship carries the richer label.
      // A writer that set only one is how the two would come to disagree.
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', $3, $4)
       on conflict (account_id, player_tag) do nothing`,
      [
        account.accountId,
        tag,
        wantPrimary,
        wantPrimary ? "primary" : (relationship ?? "watching"),
      ],
    );
    // An explicit make_primary on a tag already claimed still switches.
    if (claimed === 0 && makePrimary === true) {
      await db.query(
        `update claim set is_primary = (player_tag = $2),
                relationship = case when player_tag = $2 then 'primary'
                                    when relationship = 'primary' then 'watching'
                                    else relationship end where account_id = $1`,
        [account.accountId, tag],
      );
    }
    if (claimed > 0) {
      await logEvent(db, account.accountId, "claim_added", {
        player_tag: tag,
        via,
      });
    }

    const { started } = await reconcileRecording(
      db,
      "player",
      tag,
      account.accountId,
    );
    if (started) {
      await logEvent(db, account.accountId, "recording_started", {
        player_tag: tag,
        via,
      });
    }

    await db.query("commit");
    return {
      ok: true,
      added: claimed > 0,
      isPrimary: wantPrimary,
      recordingStarted: started,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Remove (unsubscribe from) a player.
 *
 * Returns {removed, refused?, recordingStopped, promotedPrimary}. Two
 * behaviours the old copies got wrong, and one decision:
 *
 * - Removing the primary while other players remain used to leave the
 *   account with NO primary, so default-player tools answered
 *   "not_found" for an account that still had players (#8). Then the
 *   oldest remaining claim was promoted, friends and watched players
 *   included. Since 2026-09-25 (Jamie) the removal is refused
 *   (`refused: "primary_in_use"`): choose the new primary first (adding
 *   a player with make_primary promotes it atomically). promotedPrimary
 *   is always null now.
 * - A claim-origin recording now stops when its LAST subscriber leaves,
 *   whoever created it. It used to require the remover to be the
 *   original requester, so the wrong removal order orphaned it forever
 *   (#9). Ops recordings are matched by origin and never stopped here.
 */
export async function removePlayer(db, account, { tag, via }) {
  await db.query("begin");
  try {
    await lockAccount(db, account.accountId);
    await lockSubject(db, tag);

    // Your primary is "you": removing it while you have other players is
    // refused, and you choose the new primary first (Jamie 2026-09-25;
    // it used to promote the oldest claim, a friend or a watched player
    // included, and the brief then said YOU ARE that player). Removing
    // your last player is allowed: nothing is left to be you.
    const { rows: others } = await db.query(
      `select exists (select 1 from claim where account_id = $1 and player_tag = $2 and is_primary)
                as is_primary,
              (select count(*)::int from claim where account_id = $1 and player_tag <> $2)
                as others`,
      [account.accountId, tag],
    );
    if (others[0].is_primary && others[0].others > 0) {
      await db.query("rollback");
      return {
        removed: false,
        refused: "primary_in_use",
        recordingStopped: false,
        promotedPrimary: null,
      };
    }

    const { rows: deleted } = await db.query(
      `delete from claim where account_id = $1 and player_tag = $2
       returning is_primary`,
      [account.accountId, tag],
    );
    if (deleted.length === 0) {
      await db.query("commit");
      return { removed: false, recordingStopped: false, promotedPrimary: null };
    }

    // Nothing is promoted: a primary is only removed when it is the last.
    const promotedPrimary = null;

    const { stopped } = await reconcileRecording(
      db,
      "player",
      tag,
      account.accountId,
    );
    if (stopped) {
      await logEvent(db, account.accountId, "recording_stopped", {
        player_tag: tag,
        via,
      });
    }

    await db.query("commit");
    return {
      removed: true,
      recordingStopped: stopped,
      promotedPrimary,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Add (track) a clan: tracked means recorded, within the POOL's clan slots
 * (the person's, shared with their agents; pool.mjs). One function for the
 * console and elixir_track_clan, which had each carried a copy of the slot
 * check and neither locked anything; this takes the same locks addPlayer
 * does. A clan counts once, at the widest scope any of the pool gives it,
 * and changing your own copy is never refused for a slot it already had.
 * An agent's first clan is its primary: the clan it acts for.
 *
 * Returns {ok:false, error:"quota_exceeded", scope, limit, role},
 * {ok:false, error:"not_entitled"|"not_found"}, or
 * {ok:true, added, scope, recordingStarted}.
 */
export async function addClan(db, account, { tag, scope, via }) {
  const want = scope === "activity" ? "activity" : "comprehensive";
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    if (!acct) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }
    if (acct.kind === "integration") {
      await db.query("rollback");
      return { ok: false, error: "not_entitled", kind: acct.kind };
    }
    const owner = await poolOwner(db, account.accountId);
    if (owner.account_id !== account.accountId)
      await lockAccount(db, owner.account_id);
    await lockSubject(db, tag);
    const limits = poolLimits(owner);
    if (!limits.exempt) {
      const others = await pooledClanWidth(
        db,
        owner.account_id,
        tag,
        account.accountId,
      );
      const bucket = widthScope(Math.max(scopeWidth(want), others ?? 0));
      const used = await pooledUsage(db, owner.account_id, {
        exceptClan: tag,
      });
      const inUse =
        bucket === "comprehensive"
          ? used.comprehensive_used
          : used.activity_used;
      if (inUse >= limits[bucket]) {
        await db.query("rollback");
        return {
          ok: false,
          error: "quota_exceeded",
          scope: bucket,
          limit: limits[bucket],
          role: owner.role ?? "member",
        };
      }
    }
    await db.query(
      `insert into clan (clan_tag) values ($1) on conflict do nothing`,
      [tag],
    );
    const { rows } = await db.query(
      `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, $3)
       on conflict (account_id, clan_tag) do update set scope = excluded.scope
       returning (xmax = 0) as inserted`,
      [account.accountId, tag, want],
    );
    const added = rows[0].inserted === true;
    if (acct.kind === "agent")
      await db.query(
        `update account_clan set is_primary = true
          where account_id = $1 and clan_tag = $2
            and not exists (select 1 from account_clan
                             where account_id = $1 and is_primary)`,
        [account.accountId, tag],
      );
    if (added)
      await logEvent(db, account.accountId, "clan_added", {
        clan_tag: tag,
        scope: want,
        via,
      });
    const { started } = await reconcileRecording(
      db,
      "clan",
      tag,
      account.accountId,
    );
    if (started)
      await logEvent(db, account.accountId, "recording_started", {
        clan_tag: tag,
        scope: want,
        via,
      });
    await db.query("commit");
    return { ok: true, added, scope: want, recordingStarted: started };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Remove (untrack) a clan. An agent keeps the clan it acts for: its
 * primary cannot be removed while it is primary (make another one primary
 * first), and its last clan not at all, or it would be a principal with no
 * "me".
 *
 * Returns {ok:false, error:"primary_clan"|"last_clan"} or
 * {ok:true, removed, recordingStopped}.
 */
export async function removeClan(db, account, { tag, via }) {
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    await lockSubject(db, tag);
    if (acct?.kind === "agent") {
      const { rows } = await db.query(
        `select clan_tag, is_primary from account_clan where account_id = $1`,
        [account.accountId],
      );
      const row = rows.find((r) => r.clan_tag === tag);
      if (row && rows.length === 1) {
        await db.query("rollback");
        return { ok: false, error: "last_clan" };
      }
      if (row?.is_primary) {
        await db.query("rollback");
        return { ok: false, error: "primary_clan" };
      }
    }
    const { rowCount } = await db.query(
      `delete from account_clan where account_id = $1 and clan_tag = $2`,
      [account.accountId, tag],
    );
    let stopped = false;
    if (rowCount > 0) {
      await logEvent(db, account.accountId, "clan_removed", {
        clan_tag: tag,
        via,
      });
      ({ stopped } = await reconcileRecording(db, "clan", tag, null));
      if (stopped)
        await logEvent(db, account.accountId, "recording_stopped", {
          clan_tag: tag,
          via,
        });
    }
    await db.query("commit");
    return { ok: true, removed: rowCount > 0, recordingStopped: stopped };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Re-point an agent: the clan it acts for (Jamie, 2026-09-23: "it is a user
 * account so you could change the clan that is flagged as 'its'"). One of
 * its own clans; the old primary stays tracked. Only an agent has one.
 */
export async function setPrimaryClan(db, account, { tag, via }) {
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    if (acct?.kind !== "agent") {
      await db.query("rollback");
      return { ok: false, error: "not_entitled" };
    }
    const { rows } = await db.query(
      `select 1 from account_clan where account_id = $1 and clan_tag = $2`,
      [account.accountId, tag],
    );
    if (rows.length === 0) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }
    // Clear, then set: the one-primary index refuses a second one first.
    await db.query(
      `update account_clan set is_primary = false
        where account_id = $1 and is_primary and clan_tag <> $2`,
      [account.accountId, tag],
    );
    await db.query(
      `update account_clan set is_primary = true
        where account_id = $1 and clan_tag = $2`,
      [account.accountId, tag],
    );
    await logEvent(db, account.accountId, "primary_clan_changed", {
      clan_tag: tag,
      via,
    });
    await db.query("commit");
    return { ok: true, clan_tag: tag };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
