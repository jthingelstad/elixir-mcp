/**
 * Bring Elixir Drop's profile images into Elixir, once ({avatar_import}).
 *
 *   {avatar_import: {pairs: [{account_id: "<uuid>", card_id: 26000000}]}}
 *     dry run: what it would do
 *   {avatar_import: {pairs: [...], apply: true}}
 *     set them
 *
 * Drop signs people in with Elixir, so each Drop player with an image is
 * an Elixir account id (`GET /api/v1/me`'s `account_id`). Drop exports
 * the pairs; this sets `account.avatar_card_id` and `avatar_set_at` for
 * each, and from then on Drop shows the image set in Elixir.
 *
 * It never overwrites an image: only an account with no image is set, so
 * a choice made in Elixir stands and a second run sets nothing. The card
 * must be one `POST /api/me/avatar` accepts: in the current catalog as a
 * card (`kind = 'card'`, `in_catalog`, with art). An agent account and
 * a removed account's tombstone ({account_remove}) are never set: both
 * count as an unknown account.
 *
 * Dry run unless `apply` is exactly true. One transaction. The answer is
 * counts only (set, already had one, unknown account, unknown card, and
 * the pairs refused as malformed or repeated), never an address, a name
 * or an account id.
 */

import pg from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Enough for every Drop player many times over, and well inside a
 *  Lambda payload. */
const MAX_PAIRS = 5000;
const KEYS = new Set(["pairs", "apply"]);

/** The pairs, checked, or the reason they are refused. A pair that is
 *  not `{account_id: <uuid>, card_id: <positive whole number>}` is
 *  counted as malformed; a second pair for one account as repeated. */
export function readPairs(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    return { error: "pairs required" };
  const unknown = Object.keys(spec).filter((k) => !KEYS.has(k));
  if (unknown.length) return { error: "unknown_keys", keys: unknown };
  if (Object.hasOwn(spec, "apply") && typeof spec.apply !== "boolean")
    return { error: "apply must be true or false" };
  if (!Array.isArray(spec.pairs) || spec.pairs.length === 0)
    return { error: "pairs required" };
  if (spec.pairs.length > MAX_PAIRS)
    return { error: "too_many_pairs", max: MAX_PAIRS };
  const seen = new Set();
  const pairs = [];
  let malformed = 0,
    repeated = 0;
  for (const p of spec.pairs) {
    const ok =
      p &&
      typeof p === "object" &&
      typeof p.account_id === "string" &&
      UUID.test(p.account_id) &&
      Number.isSafeInteger(p.card_id) &&
      p.card_id > 0;
    if (!ok) {
      malformed += 1;
      continue;
    }
    const id = p.account_id.toLowerCase();
    if (seen.has(id)) {
      repeated += 1;
      continue;
    }
    seen.add(id);
    pairs.push({ account_id: id, card_id: p.card_id });
  }
  return { pairs, malformed, repeated };
}

export async function avatarImportOp(databaseUrl, spec) {
  const read = readPairs(spec);
  if (read.error) return read;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await avatarImport(db, read, spec.apply === true);
  } finally {
    await db.end();
  }
}

/** The import on an open connection (tests call it on a scratch one). */
export async function avatarImport(db, { pairs, malformed, repeated }, apply) {
  const accounts = pairs.map((p) => p.account_id);
  const cards = pairs.map((p) => p.card_id);
  await db.query("begin");
  try {
    // The accounts named are locked first, so a choice made in Elixir
    // meanwhile waits and then stands (the update also requires null).
    await db.query(
      `select 1 from account where account_id = any($1::uuid[])
        order by account_id for update`,
      [accounts],
    );
    // Each pair once, with what it meets: the account (a person's), its
    // image now, and whether the card can be a profile image.
    const { rows } = await db.query(
      `select i.ord, a.account_id is not null as known,
              a.avatar_card_id is not null as has_one,
              exists (select 1 from card c
                       where c.card_id = i.card_id and c.kind = 'card'
                         and c.in_catalog and c.icon_medium is not null)
                as card_ok
         from unnest($1::uuid[], $2::int[]) with ordinality
                as i(account_id, card_id, ord)
         left join account a on a.account_id = i.account_id
                            and coalesce(a.kind, 'person') = 'person'
                            and a.email_hash not like 'removed:%'
        order by i.ord`,
      [accounts, cards],
    );
    const out = {
      dry_run: !apply,
      pairs: pairs.length + malformed + repeated,
      set: 0,
      already_had_one: 0,
      unknown_account: 0,
      unknown_card: 0,
      malformed,
      repeated,
    };
    const toSet = [];
    for (const r of rows) {
      const p = pairs[Number(r.ord) - 1];
      if (!r.known) out.unknown_account += 1;
      else if (r.has_one) out.already_had_one += 1;
      else if (!r.card_ok) out.unknown_card += 1;
      else toSet.push(p);
    }
    if (!apply) out.would_set = toSet.length;
    else if (toSet.length) {
      const { rowCount } = await db.query(
        `update account a set avatar_card_id = i.card_id, avatar_set_at = now()
           from unnest($1::uuid[], $2::int[]) as i(account_id, card_id)
          where a.account_id = i.account_id and a.avatar_card_id is null`,
        [toSet.map((p) => p.account_id), toSet.map((p) => p.card_id)],
      );
      out.set = rowCount;
    }
    await db.query(apply ? "commit" : "rollback");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
