/** Private Clan storage; takes the request's existing connected PG client.
 * Transactions belong to the caller, including serialization of a clan's
 * multi-item changes. Never creates schemas or opens a connection here. */
import { ledgerOver } from "./ledger.mjs";

export function createPostgresStore(db) {
  return {
    async get(pk) {
      return (
        (await db.query("select body from clan_state where pk = $1", [pk]))
          .rows[0]?.body ?? null
      );
    },
    async put(item) {
      await db.query(
        `insert into clan_state (pk, body) values ($1, $2::jsonb)
        on conflict (pk) do update set body = excluded.body, updated_at = now()`,
        [item.pk, JSON.stringify(item)],
      );
    },
    async remove(pk) {
      await db.query("delete from clan_state where pk = $1", [pk]);
    },
    async listByPartition(partition, prefix = "") {
      return (
        await db.query(
          `select body from clan_state where partition_key = $1
        and starts_with(sort_key, $2) order by sort_key collate "C"`,
          [partition, prefix],
        )
      ).rows.map((r) => r.body);
    },
    listByPrefix(clanTag, prefix = "") {
      return this.listByPartition(`clan#${clanTag}`, prefix);
    },
    async increment(pk) {
      const r = await db.query(
        `insert into clan_state (pk, body) values ($1, jsonb_build_object('pk', $1::text, 'n', 1))
        on conflict (pk) do update set body = jsonb_set(clan_state.body, '{n}', to_jsonb(coalesce((clan_state.body ->> 'n')::bigint, 0) + 1)), updated_at = now()
        returning body ->> 'n' as n`,
        [pk],
      );
      return Number(r.rows[0].n);
    },
    async setIfAbsent(pk, attr, value) {
      const r = await db.query(
        `update clan_state set body = jsonb_set(body, array[$2::text], $3::jsonb), updated_at = now()
        where pk = $1 and not body ? $2 returning pk`,
        [pk, attr, JSON.stringify(value)],
      );
      return r.rowCount === 1;
    },
    async claimDay(pk, day, at) {
      const r = await db.query(
        `insert into clan_state (pk, body) values ($1, jsonb_build_object('pk', $1::text, 'day', $2::text, 'at', $3::text))
        on conflict (pk) do update set body = clan_state.body || excluded.body, updated_at = now()
        where clan_state.body ->> 'day' is distinct from $2::text returning pk`,
        [pk, day, at],
      );
      return r.rowCount === 1;
    },
  };
}

export function createPostgresLedger(db) {
  return ledgerOver(createPostgresStore(db));
}
