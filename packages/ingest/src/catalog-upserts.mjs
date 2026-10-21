/**
 * The two upserts nearly every submit makes for rows it usually finds
 * already right: the arena catalog's names and the players a battle log
 * names.
 *
 * ON CONFLICT DO UPDATE locks the conflicting row even when its WHERE
 * says there is nothing to change, and keeps the lock to commit. So two
 * submits naming the same arena or the same player queued on each other
 * for no change: 83 waits over a second in the week to 2026-10-21, 60 of
 * them on the two busiest arena rows (Postgres log, `ShareLock on
 * transaction`; platform review §2). Each statement now leaves out the
 * rows its WHERE would not change, read without a lock, so only a row it
 * really changes is locked. A row another submit has not yet committed
 * still waits, as before: the insert has to know whether it exists.
 * What is written is what was written before.
 */

/** Name the arenas observed (Map of arena id to name), keeping the
 *  newest name; a known arena under the same name is untouched. */
export async function upsertArenaNames(db, arenas, observedAt) {
  if (arenas.size === 0) return;
  await db.query(
    `insert into arena (arena_id, name, observed_at)
     select t.id, t.name, $3::timestamptz from unnest($1::int[], $2::text[]) as t(id, name)
     where not exists (
       select 1 from arena a
       where a.arena_id = t.id and a.name is not distinct from t.name)
     on conflict (arena_id) do update
       set name = excluded.name, observed_at = excluded.observed_at
     where arena.name is distinct from excluded.name`,
    [[...arenas.keys()], [...arenas.values()], observedAt],
  );
}

/** The players a battle log names: a new tag is a row; a known one gets
 *  its first name and, at most daily, last_seen_at. Names fill NULLs
 *  only: roster and profile observations stay authoritative. */
export async function upsertPlayersSeen(db, tags, names) {
  if (tags.length === 0) return;
  await db.query(
    `insert into player (player_tag, name)
     select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
     where not exists (
       select 1 from player p
       where p.player_tag = t.tag
         and not coalesce((p.name is null and t.name is not null)
                          or p.last_seen_at < now() - interval '1 day', false))
     on conflict (player_tag) do update set
       last_seen_at = now(),
       name = coalesce(player.name, excluded.name)
     where (player.name is null and excluded.name is not null)
        or player.last_seen_at < now() - interval '1 day'`,
    [tags, names],
  );
}
