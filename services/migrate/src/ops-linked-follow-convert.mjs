/**
 * Convert existing follows to linked follows ({linked_follow_convert},
 * 2026-11-15). Jamie approved linked follows with "existing follows
 * convert as recommended": a person who already follows a player that
 * another account has Verified now follows that account, and through it
 * the account's other Verified players.
 *
 *   {linked_follow_convert: {}}                dry run: what it would do
 *   {linked_follow_convert: {apply: true}}     do it
 *
 * Run it once, after the deploy that ships linked follows, never beside
 * one. The live paths keep the link from then on; this pass only catches
 * up the follows made before them.
 *
 * Each (reader, account) pair goes through the live path
 * (followAccountLinked, via "convert"), so the slots, the cap and the
 * bell behave exactly as a tap would: the account follow is logged as
 * `account_followed`, and a player the reader cannot take (no free slot,
 * no player of their own) is skipped and told as `follow_skipped`.
 * It also catches up the account follows made before linked follows,
 * which followed no players: each follows the account's Verified players
 * it lacks. Nothing is unfollowed. Idempotent: a pair already linked
 * (account followed, every Verified player followed) is not read again,
 * so a second apply does nothing, except to try again a player a reader
 * could not take the first time.
 *
 * The dry run only reads: the pairs and the players each would add.
 * The answer is counts only, never an account id, a tag or a name.
 */
import pg from "pg";
import { followAccountLinked, linkedTagsToFollow } from "@elixir-mcp/claims";

const KEYS = new Set(["apply"]);

/** The request, checked, or why it is refused. */
export function readSpec(spec) {
  const s = spec === true ? {} : spec;
  if (!s || typeof s !== "object" || Array.isArray(s))
    return { error: "linked_follow_convert takes an object" };
  const unknown = Object.keys(s).filter((k) => !KEYS.has(k));
  if (unknown.length) return { error: "unknown_keys", keys: unknown };
  if (Object.hasOwn(s, "apply") && typeof s.apply !== "boolean")
    return { error: "apply must be true or false" };
  return { apply: s.apply === true };
}

/**
 * The pairs to link: an approved person holding a friend claim on a
 * player Verified (as primary or alt) by another approved person, with
 * no account follow between them yet; and every account follow already
 * made (before linked follows it followed no players), kept when the
 * account has a Verified player its follower does not follow yet.
 */
async function pairsToLink(db) {
  const { rows } = await db.query(
    `select distinct f.account_id as reader_id, v.account_id as owner_id
       from claim f
       join account r on r.account_id = f.account_id
                     and r.kind = 'person' and r.status = 'approved'
       join claim v on v.player_tag = f.player_tag
                   and v.status = 'verified'
                   and (v.is_primary or v.relationship in ('primary', 'alt'))
                   and v.account_id <> f.account_id
       join account o on o.account_id = v.account_id
                     and o.kind = 'person' and o.status = 'approved'
      where f.relationship = 'friend' and not f.is_primary
        and not exists (
          select 1 from account_follow af
           where af.account_id = f.account_id
             and af.followed_account_id = v.account_id)
     union
     select af.account_id, af.followed_account_id
       from account_follow af
       join account r on r.account_id = af.account_id
                     and r.kind = 'person' and r.status = 'approved'
       join account o on o.account_id = af.followed_account_id
                     and o.kind = 'person' and o.status = 'approved'
     order by 1, 2`,
  );
  const pairs = [];
  for (const p of rows) {
    const tags = await linkedTagsToFollow(db, p.reader_id, p.owner_id);
    const followsAlready = (
      await db.query(
        `select 1 from account_follow
          where account_id = $1 and followed_account_id = $2`,
        [p.reader_id, p.owner_id],
      )
    ).rows.length;
    // An account follow with every Verified player followed is done.
    if (followsAlready && !tags.length) continue;
    pairs.push({ ...p, tags: tags.length });
  }
  return pairs;
}

/** One pass over every pair. Counts only. */
export async function linkedFollowConvert(db, spec) {
  const started = Date.now();
  const pairs = await pairsToLink(db);
  const out = {
    dry_run: !spec.apply,
    pairs: pairs.length,
    readers: new Set(pairs.map((p) => p.reader_id)).size,
    accounts_followed: 0,
    players_to_follow: 0,
    players_followed: 0,
    skipped: {},
    failed: 0,
  };
  for (const { reader_id: readerId, owner_id: ownerId, tags } of pairs) {
    if (!spec.apply) {
      out.players_to_follow += tags;
      continue;
    }
    try {
      const r = await followAccountLinked(
        db,
        { accountId: readerId },
        ownerId,
        { via: "convert" },
      );
      if (r.error) {
        out.skipped[r.error] = (out.skipped[r.error] ?? 0) + 1;
        continue;
      }
      if (r.account_added) out.accounts_followed += 1;
      out.players_followed += r.followed.length;
      for (const s of r.skipped)
        out.skipped[s.reason] = (out.skipped[s.reason] ?? 0) + 1;
    } catch {
      out.failed += 1;
    }
  }
  if (spec.apply) delete out.players_to_follow;
  out.ms = Date.now() - started;
  return out;
}

export async function linkedFollowConvertOp(databaseUrl, raw) {
  const spec = readSpec(raw);
  if (spec.error) return spec;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await linkedFollowConvert(db, spec);
  } finally {
    await db.end();
  }
}
