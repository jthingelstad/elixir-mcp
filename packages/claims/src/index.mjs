/**
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

import { roleQuotas } from "@elixir-mcp/contracts";

/** Serialize every claim mutation for one account behind its own row. */
async function lockAccount(db, accountId) {
  const { rows } = await db.query(
    `select account_id, role, is_owner, max_player_recordings as override
     from account where account_id = $1 for update`,
    [accountId],
  );
  return rows[0] ?? null;
}

async function logEvent(db, accountId, kind, detail) {
  await db.query(
    `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
    [accountId, kind, JSON.stringify(detail)],
  );
}

/**
 * Add (subscribe to) a player.
 *
 * Returns {ok:false, error:"quota_exceeded", limit, role} or
 * {ok:true, added, isPrimary, recordingStarted}. `added` is false on a
 * re-add, which stays idempotent.
 */
export async function addPlayer(db, account, { tag, makePrimary, via }) {
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    if (!acct) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }

    const exempt = acct.is_owner || acct.role === "admin";
    if (!exempt) {
      const { rows: cap } = await db.query(
        `select exists (select 1 from gateway g
                        where g.owner_account_id = $1 and g.status = 'active') as operator,
                (select count(*)::int from claim c
                 where c.account_id = $1 and c.player_tag <> $2) as added`,
        [account.accountId, tag],
      );
      const limit =
        acct.override ??
        roleQuotas(acct.role, { operator: cap[0].operator }).player_slots;
      if (cap[0].added >= limit) {
        await db.query("rollback");
        return {
          ok: false,
          error: "quota_exceeded",
          limit,
          role: acct.role ?? "member",
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
    const first = counted[0].n === 0;
    const wantPrimary = makePrimary === true || first;

    // Clear the old primary BEFORE inserting the new one. Inserting a
    // second is_primary row first is what tripped the partial unique
    // index, so the switch never happened and the whole add failed (#8).
    if (wantPrimary) {
      await db.query(
        `update claim set is_primary = false
         where account_id = $1 and is_primary and player_tag <> $2`,
        [account.accountId, tag],
      );
    }

    const { rowCount: claimed } = await db.query(
      `insert into claim (account_id, player_tag, status, is_primary)
       values ($1, $2, 'unverified', $3)
       on conflict (account_id, player_tag) do nothing`,
      [account.accountId, tag, wantPrimary],
    );
    // An explicit make_primary on a tag already claimed still switches.
    if (claimed === 0 && makePrimary === true) {
      await db.query(
        `update claim set is_primary = (player_tag = $2) where account_id = $1`,
        [account.accountId, tag],
      );
    }
    if (claimed > 0) {
      await logEvent(db, account.accountId, "claim_added", {
        player_tag: tag,
        via,
      });
    }

    const { rowCount: started } = await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       select 'player', $1, $2, 'claim'
       where not exists (select 1 from recording
                         where subject_type = 'player' and subject_tag = $1
                           and status = 'active')`,
      [tag, account.accountId],
    );
    if (started > 0) {
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
      recordingStarted: started > 0,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Remove (unsubscribe from) a player.
 *
 * Returns {removed, recordingStopped, promotedPrimary}. Two behaviours
 * the old copies got wrong:
 *
 * - Removing the primary while other players remain used to leave the
 *   account with NO primary, so default-player tools answered
 *   "not_found" for an account that still had players (#8). The oldest
 *   remaining claim is promoted instead.
 * - A claim-origin recording now stops when its LAST subscriber leaves,
 *   whoever created it. It used to require the remover to be the
 *   original requester, so the wrong removal order orphaned it forever
 *   (#9). Ops recordings are matched by origin and never stopped here.
 */
export async function removePlayer(db, account, { tag, via }) {
  await db.query("begin");
  try {
    await lockAccount(db, account.accountId);

    const { rows: deleted } = await db.query(
      `delete from claim where account_id = $1 and player_tag = $2
       returning is_primary`,
      [account.accountId, tag],
    );
    if (deleted.length === 0) {
      await db.query("commit");
      return { removed: false, recordingStopped: false, promotedPrimary: null };
    }

    let promotedPrimary = null;
    if (deleted[0].is_primary) {
      const { rows: promoted } = await db.query(
        `update claim set is_primary = true
         where account_id = $1 and player_tag = (
           select player_tag from claim where account_id = $1
           order by created_at, player_tag limit 1
         )
         returning player_tag`,
        [account.accountId],
      );
      promotedPrimary = promoted[0]?.player_tag ?? null;
    }

    const { rowCount: stopped } = await db.query(
      `update recording set status = 'stopped'
       where subject_type = 'player' and subject_tag = $1
         and status = 'active' and origin = 'claim'
         and not exists (select 1 from claim where player_tag = $1)`,
      [tag],
    );
    if (stopped > 0) {
      await logEvent(db, account.accountId, "recording_stopped", {
        player_tag: tag,
        via,
      });
    }

    await db.query("commit");
    return {
      removed: true,
      recordingStopped: stopped > 0,
      promotedPrimary,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
