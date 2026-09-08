/**
 * Who is subscribed to what, and therefore what gets recorded.
 *
 * Two things create a subscription: an account CLAIMS a player, or a
 * COLLECTION names a subject. Either is a reason to record it, and a
 * recording ends only when no reason is left. Both live here so the
 * two can never disagree about it.
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

import { roleQuotas } from "@elixir-mcp/contracts";

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
 * A subject is recorded while ANY reason holds: an account claims it, or
 * a collection names it. When the last one goes, the recording stops.
 * An ops recording is never touched - it exists precisely because
 * somebody decided to record a subject nobody subscribes to.
 *
 * Callers must already hold the subject lock.
 */
export async function reconcileRecording(db, subjectType, tag, requestedBy) {
  const { rows } = await db.query(
    `select
       -- EVERY reason a subject is recorded, counted in one place. An
       -- account associates with a player through claim and with a clan
       -- through account_clan; a collection names either. A function
       -- that knows only some of these stops recordings the others
       -- still want, which is exactly how removing a clan you had added
       -- used to stop a clan a collection was curating.
       ($2 = 'player'
        and exists (select 1 from claim where player_tag = $1)) as claimed,
       ($2 = 'clan'
        and exists (select 1 from account_clan where clan_tag = $1)) as added,
       ($2 = 'clan'
        and exists (select 1 from account_clan
                    where clan_tag = $1 and scope = 'comprehensive')) as added_deep,
       exists (select 1 from collection_member m
               join collection c on c.collection_id = m.collection_id
               where m.subject_tag = $1 and c.kind = $2) as collected,
       -- How deep any collection asks this subject to be recorded. Two
       -- collections can name it at different depths; the deepest wins.
       exists (select 1 from collection_member m
               join collection c on c.collection_id = m.collection_id
               where m.subject_tag = $1 and c.kind = $2
                 and c.scope = 'comprehensive') as collected_deep,
       exists (select 1 from recording
               where subject_type = $2 and subject_tag = $1
                 and status = 'active' and origin = 'ops') as ops,
       exists (select 1 from recording
               where subject_type = $2 and subject_tag = $1
                 and status = 'active') as active`,
    [tag, subjectType],
  );
  const { claimed, added, added_deep, collected, collected_deep, ops, active } =
    rows[0];
  const wanted = claimed || added || collected;
  // A claim means somebody added this player to their account, which has
  // always meant full capture. A clan carries the depth each account
  // asked for; a collection the depth it asked for. Widest reason wins.
  const scope =
    claimed || added_deep || collected_deep ? "comprehensive" : "activity";

  if (ops) return { started: false, stopped: false };

  if (wanted && !active) {
    if (subjectType === "player") {
      await db.query(
        `insert into player (player_tag) values ($1) on conflict do nothing`,
        [tag],
      );
    }
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin, scope)
       values ($2, $1, $3, $4, $5)`,
      [
        tag,
        subjectType,
        requestedBy,
        claimed || added ? "claim" : "collection",
        scope,
      ],
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
      // Players upgrade only. A collection asking for more depth deepens
      // an existing recording; one asking for less never takes capture
      // away from whoever is already relying on it.
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
export async function addPlayer(db, account, { tag, makePrimary, via }) {
  await db.query("begin");
  try {
    const acct = await lockAccount(db, account.accountId);
    if (!acct) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }
    await lockSubject(db, tag);

    // A claim asserts "this player is me", and only a person is a me. An agent
    // acts FOR a clan and an integration has no self at all — letting either
    // hold a claim would put an is_primary row on a principal with no identity
    // to be primary about, and every tool that defaults to "your tag" would
    // start answering for a bot.
    if (acct.kind && acct.kind !== "person") {
      await db.query("rollback");
      return { ok: false, error: "not_entitled", kind: acct.kind };
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
    await lockSubject(db, tag);

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
 * Re-apply a collection's own settings to the members it already has.
 *
 * Changing scope from activity to comprehensive changes what the
 * collection is asking for without changing who is in it. Reconciling
 * only added/removed tags therefore deepens nobody, and the collection
 * keeps promising battle history it is not capturing. This reconciles
 * the membership read under the collection's lock, so it also cannot
 * miss a member that arrived since the caller last looked.
 */
export async function reconcileCollection(db, collectionId) {
  await db.query("begin");
  try {
    const { rows: col } = await db.query(
      `select collection_id, kind, owner_account from collection
       where collection_id = $1 for update`,
      [collectionId],
    );
    if (!col[0]) {
      await db.query("rollback");
      return { found: false, members: 0, recordingsStarted: 0 };
    }
    const { rows: mem } = await db.query(
      `select subject_tag from collection_member where collection_id = $1`,
      [collectionId],
    );
    const tags = mem.map((r) => r.subject_tag).sort();
    if (tags.length > 0) {
      await db.query(
        `select pg_advisory_xact_lock(hashtext(t)) from unnest($1::text[]) as t`,
        [tags],
      );
    }
    let started = 0;
    for (const tag of tags) {
      const r = await reconcileRecording(
        db,
        col[0].kind,
        tag,
        col[0].owner_account,
      );
      if (r.started) started += 1;
    }
    await db.query("commit");
    return { found: true, members: tags.length, recordingsStarted: started };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Delete a collection and settle what it was keeping alive.
 *
 * Membership rows cascade away on their own, but a cascade reconciles
 * nothing: a subject whose only reason to be recorded was this
 * collection would stay actively scheduled forever, spending the global
 * capture budget on a collection that no longer exists. Removing a
 * member through the ordinary membership path already stops it, so
 * deleting the parent must reach the same state.
 *
 * Subjects still wanted by another collection or by an account claim
 * keep recording, and operator-owned recordings are never touched —
 * both of those are reconcileRecording's own rules, honoured by asking
 * it after the delete rather than deciding here.
 */
export async function deleteCollection(db, collectionId) {
  await db.query("begin");
  try {
    const { rows: col } = await db.query(
      `select collection_id, kind, owner_account from collection
       where collection_id = $1 for update`,
      [collectionId],
    );
    if (!col[0]) {
      await db.query("rollback");
      return { deleted: false, members: 0, recordingsStopped: 0 };
    }
    const { rows: mem } = await db.query(
      `select subject_tag from collection_member where collection_id = $1`,
      [collectionId],
    );
    // Same stable order as every other subject-touching write, so a
    // delete racing an edit queues instead of deadlocking.
    const tags = mem.map((r) => r.subject_tag).sort();
    if (tags.length > 0) {
      await db.query(
        `select pg_advisory_xact_lock(hashtext(t)) from unnest($1::text[]) as t`,
        [tags],
      );
    }
    await db.query(`delete from collection where collection_id = $1`, [
      collectionId,
    ]);
    let stopped = 0;
    for (const tag of tags) {
      const r = await reconcileRecording(
        db,
        col[0].kind,
        tag,
        col[0].owner_account,
      );
      if (r.stopped) stopped += 1;
    }
    await db.query("commit");
    return { deleted: true, members: tags.length, recordingsStopped: stopped };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Replace a collection's membership wholesale.
 *
 * `tags` is the membership the caller wants, already normalized. What is
 * absent leaves, what is new arrives, and every affected subject has its
 * recording reconciled: naming a tag in a collection is a reason to
 * record it, and removing the last reason stops it.
 *
 * Wholesale replacement is what a textarea edit means, and it is also
 * the shape an external manager wants ("here is the current roster"),
 * so it can be driven by a service token later without a second code
 * path. Adds and removes are diffed rather than delete-then-insert, so
 * added_at survives for members that stay.
 *
 * `mode` decides what `tags` means, and it MUST be resolved here rather
 * than by the caller. A caller that reads the membership, computes a
 * whole desired set and sends it as a replacement is racing: two
 * concurrent adds both build their set from the same snapshot, and the
 * second one's replacement deletes the first one's member. Deltas are
 * applied against the membership read under this function's own lock.
 *
 * `reconcileAll` reconciles every surviving member, not only the ones
 * that moved. Membership can be unchanged while the *depth* the
 * collection asks for has changed, and those members must be deepened
 * too.
 */
export async function setCollectionMembers(
  db,
  collection,
  tags,
  { mode = "set", reconcileAll = false } = {},
) {
  const given = [...new Set(tags)];
  await db.query("begin");
  try {
    await db.query(
      `select collection_id from collection where collection_id = $1 for update`,
      [collection.collectionId],
    );
    const { rows: current } = await db.query(
      `select subject_tag from collection_member where collection_id = $1`,
      [collection.collectionId],
    );
    const have = new Set(current.map((r) => r.subject_tag));
    // Resolve the delta against what is there NOW, inside the lock.
    const wanted =
      mode === "add"
        ? [...new Set([...have, ...given])]
        : mode === "remove"
          ? [...have].filter((t) => !given.includes(t))
          : given;
    const added = wanted.filter((t) => !have.has(t));
    const removed = [...have].filter((t) => !wanted.includes(t));

    // Touch subjects in a stable order so two concurrent edits queue
    // rather than deadlock on the per-subject locks. One round trip:
    // an externally managed collection syncs hundreds of tags at once,
    // and a query per tag would hold the transaction open for as long
    // as the network takes, times the roster.
    const touched = [...added, ...removed].sort();
    const toReconcile = (
      reconcileAll ? [...new Set([...wanted, ...removed])] : touched
    ).sort();
    if (toReconcile.length > 0) {
      await db.query(
        `select pg_advisory_xact_lock(hashtext(t)) from unnest($1::text[]) as t`,
        [toReconcile],
      );
    }
    if (added.length > 0) {
      await db.query(
        `insert into collection_member (collection_id, subject_tag)
         select $1, unnest($2::text[]) on conflict do nothing`,
        [collection.collectionId, added],
      );
    }
    if (removed.length > 0) {
      await db.query(
        `delete from collection_member
         where collection_id = $1 and subject_tag = any($2::text[])`,
        [collection.collectionId, removed],
      );
    }
    let started = 0;
    let stopped = 0;
    for (const tag of toReconcile) {
      const r = await reconcileRecording(
        db,
        collection.kind,
        tag,
        collection.ownerAccount,
      );
      if (r.started) started += 1;
      if (r.stopped) stopped += 1;
    }
    await db.query("commit");
    return {
      added: added.length,
      removed: removed.length,
      total: wanted.length,
      recordingsStarted: started,
      recordingsStopped: stopped,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
