/**
 * The verified-tag census ({verified_tag_census: {dry_run: true}}), a read.
 *
 * Since 2026-10-12 a verified tag is its owner's (#556): no other account
 * may claim it as its primary or an alt, and verifying ends such claims.
 * The ending applies to verifications from then on, so claims that
 * collided before stay; this counts them, and changes nothing:
 *
 *   - `verified_tags`: tags some account has verified
 *   - `colliding_tags`: of those, tags another account also claims
 *   - `by_relationship`: the other accounts' claims on verified tags, by
 *     what the claim says (`primary`, `alt`, `friend`, `watching`), each
 *     as claims, distinct tags and distinct accounts
 *   - `self`: the `primary` and `alt` ones together, the collisions the
 *     rule concerns, with the accounts whose primary it is
 *
 * Counts only: no account, address, name or tag. A read-only session;
 * `dry_run: true` is the only shape it takes, and it writes nothing.
 */

import pg from "pg";

const RELATIONSHIPS = ["primary", "alt", "friend", "watching"];

export async function verifiedTagCensusOp(databaseUrl, spec = {}) {
  if (spec?.dry_run !== true)
    return { error: "verified_tag_census is a read: pass {dry_run: true}" };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set default_transaction_read_only = on");
    const {
      rows: [totals],
    } = await db.query(
      `select count(distinct v.player_tag)::int as verified_tags,
              count(distinct c.player_tag)::int as colliding_tags
         from claim v
         left join claim c on c.player_tag = v.player_tag
                          and c.account_id <> v.account_id
        where v.status = 'verified'`,
    );
    const { rows } = await db.query(
      `select case when c.is_primary then 'primary' else c.relationship end as relationship,
              count(*)::int as claims,
              count(distinct c.player_tag)::int as tags,
              count(distinct c.account_id)::int as accounts
         from claim v
         join claim c on c.player_tag = v.player_tag
                     and c.account_id <> v.account_id
        where v.status = 'verified'
        group by 1`,
    );
    const {
      rows: [self],
    } = await db.query(
      `select count(*)::int as claims,
              count(distinct c.player_tag)::int as tags,
              count(distinct c.account_id)::int as accounts,
              count(distinct c.account_id) filter (where c.is_primary)::int
                as accounts_whose_primary
         from claim v
         join claim c on c.player_tag = v.player_tag
                     and c.account_id <> v.account_id
        where v.status = 'verified'
          and (c.is_primary or c.relationship in ('primary', 'alt'))`,
    );
    const by = Object.fromEntries(
      RELATIONSHIPS.map((r) => [r, { claims: 0, tags: 0, accounts: 0 }]),
    );
    for (const r of rows)
      by[r.relationship] = {
        claims: r.claims,
        tags: r.tags,
        accounts: r.accounts,
      };
    return {
      dry_run: true,
      verified_tags: totals.verified_tags,
      colliding_tags: totals.colliding_tags,
      by_relationship: by,
      self,
    };
  } finally {
    await db.end();
  }
}
