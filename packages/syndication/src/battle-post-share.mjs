/** A shared post about a battle, posted in its player's clan's Discord
 *  (social slice 9, #767; Jamie, 2026-11-12: "a shared post can post to
 *  the clan's Discord through Clan's webhook"). Until 0292 this was a
 *  shared highlight; a highlight is now a post with a battle attached.
 *
 *  Only by its author's own act, once, and only where the clan's leaders
 *  allow it:
 *  - the post's author asks (nobody else's request finds it), the post
 *    is about a battle and shared already (its link is public, so the
 *    Discord line makes nothing public that was not), it is visible, and
 *    the account still holds a verified claim on its player;
 *  - the player is a current member of a clan whose activity channel
 *    (Clan ▸ Social ▸ Discord) is connected and on, with the clan's
 *    policy saved and "Shared posts about battles" turned on by a leader
 *    (off by default: `activityCategories`, key `highlights`);
 *  - once per post (0254, carried to account_post by 0292): a second ask
 *    sends nothing, and a highlight posted before 0292 keeps its stamp.
 *
 *  The message goes the way every clan activity post goes: an outbox
 *  object on the timeline-discord/ lane, kind `clan_activity`, with the
 *  channel's webhook still sealed as the row keeps it; the relay opens
 *  it, posts with `allowed_mentions: { parse: [] }` and SUPPRESS_EMBEDS,
 *  never repeats a post whose outcome is unknown, and answers in a
 *  receipt to the quality ledger row written here (discord_post). The
 *  key is the post's own, so even a duplicate hand-off is one post.
 *
 *  The words: the player's game name (escaped), what the battle was, the
 *  owner's words as a quote (escaped, one line) and one masked link to
 *  the shared post, its address in angle brackets: no preview (Jamie,
 *  2026-11-12: "make sure they do not have previews"). No clan name, no
 *  opponent, no tag, no time. Edited words or a deletion later change
 *  nothing in the channel. */
import { createHash } from "node:crypto";
import { postUrl } from "@elixir-mcp/contracts";
import { activityCategories, escapeDiscord } from "@elixir-mcp/clan-engine";
import { withLink } from "./story-link.mjs";
import { aside, newLedgerId, recordPosts } from "./quality.mjs";

/** The relay's key for this post's Discord line: one per post, in the
 *  form its lane takes (`tl_` and 20 hex). A highlight that went before
 *  0292 went under `highlight-clan:<uuid>`; its stamp came over with it,
 *  so it is never asked again. */
export const battlePostKey = (postId) =>
  `tl_${createHash("sha256")
    .update(`post-clan:${postId}`)
    .digest("hex")
    .slice(0, 20)}`;

const RESULT = { win: "win", loss: "loss", draw: "draw" };

/** What the battle was: "a 3-1 win", or "a battle" when the record
 *  cannot say. */
function battleWords({ outcome, crowns, crowns_against: against }) {
  const result = RESULT[outcome] ?? null;
  if (!result) return "a battle";
  return Number.isInteger(crowns) && Number.isInteger(against)
    ? `a ${crowns}-${against} ${result}`
    : `a ${result}`;
}

/** The message's content. Pure: everything a person typed or a game name
 *  carries is made literal (markdown, mentions, timestamps, links). */
export function battlePostContent({ name, playerTag, words, battle, url }) {
  const who = escapeDiscord(String(name ?? "").trim()) || playerTag;
  const lines = [`**${who}** posted about ${battleWords(battle)}`];
  const said = escapeDiscord(String(words ?? "").trim()).trim();
  // Typographic quotes open the line, so nothing typed can lead it as a
  // heading, a list or a subtext.
  if (said) lines.push(`> “${said}”`);
  return withLink(lines.join("\n"), url);
}

const fail = (status, error, message) => ({ status, error, message });

/** The battle post as its author may post it, with its player's clan and
 *  battle; null when it is not the account's, not about a battle, or not
 *  visible. */
async function readOwn(db, accountId, postId, lock = false) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(postId ?? ""))) return null;
  const {
    rows: [h],
  } = await db.query(
    `select h.post_id::text as post_id, h.item_id, h.player_tag, h.battle_id,
            h.body as words, ts.share_id, h.created_at, h.updated_at,
            h.clan_discord_at, h.clan_discord_clan,
            p.name,
            exists (select 1 from claim c
                     where c.account_id = h.account_id
                       and c.player_tag = h.player_tag
                       and c.status = 'verified') as verified,
            (select cm.clan_tag from clan_membership cm
              where cm.player_tag = h.player_tag
                and cm.left_observed_at is null
              order by cm.joined_observed_at desc nulls last
              limit 1) as clan_tag
       from account_post h
       left join timeline_share ts on ts.item_id = h.item_id
         and ts.created_at >= now() - interval '1 year'
       left join player p on p.player_tag = h.player_tag
      where h.post_id = $1::bigint and h.account_id = $2
        and h.battle_id is not null and h.status = 'visible'
      ${lock ? "for update of h" : ""}`,
    [String(postId), accountId],
  );
  return h ?? null;
}

/** The clan's channel when it takes shared battle posts now, else null. */
async function openChannel(db, clanTag, policyFor) {
  if (!clanTag) return null;
  const {
    rows: [row],
  } = await db.query(
    `select channel_id, webhook_sealed, webhook_fp, enabled, categories
       from clan_activity_discord where clan_tag = $1`,
    [clanTag],
  );
  if (!row?.enabled || !row.webhook_sealed) return null;
  const policy = await policyFor(db, clanTag);
  const on = activityCategories(row.categories, policy?.values ?? null);
  return on.highlights ? row : null;
}

/** What the battle page shows its author for one battle post: whether it
 *  may go to the clan's Discord now, and when it went. Never the clan's
 *  webhook or settings beyond that yes or no. */
export async function battlePostClanDiscord(
  db,
  accountId,
  postId,
  { policyFor },
) {
  const h = await readOwn(db, accountId, postId);
  if (!h) return null;
  if (h.clan_discord_at)
    return { available: false, posted_at: h.clan_discord_at.toISOString() };
  const ready =
    h.verified && Boolean(await openChannel(db, h.clan_tag, policyFor));
  return { available: ready, posted_at: null };
}

/**
 * Post a battle post in its player's clan's Discord: the author's act.
 * `outbox(lane, body, opts)` is the outbox writer; `policyFor(db, tag)`
 * the clan's saved policy. Answers `{ status, posted_at, already }` or a
 * refusal `{ status, error, message }`.
 */
export async function postBattlePostToClan(
  db,
  accountId,
  postId,
  { outbox, policyFor, now = Date.now() },
) {
  if (!outbox)
    return fail(503, "unavailable", "Discord posting is not set up.");
  await db.query("begin");
  try {
    const out = await post(db, accountId, postId, {
      outbox,
      policyFor,
      now,
    });
    await db.query(out.error ? "rollback" : "commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

async function post(db, accountId, postId, { outbox, policyFor, now }) {
  const h = await readOwn(db, accountId, postId, true);
  if (!h) return fail(404, "not_found", "No such post.");
  if (h.clan_discord_at)
    return {
      status: 200,
      posted_at: h.clan_discord_at.toISOString(),
      already: true,
    };
  if (!h.share_id) return fail(409, "not_shared", "Share the post first.");
  if (!h.verified)
    return fail(
      403,
      "not_your_player",
      "Only a player you have verified can post to their clan's Discord.",
    );
  if (!h.clan_tag)
    return fail(409, "no_clan", "This player is not in a clan right now.");
  const row = await openChannel(db, h.clan_tag, policyFor);
  if (!row)
    return fail(
      409,
      "not_open",
      "Your clan's leaders have not turned on shared posts in its Discord.",
    );
  const {
    rows: [battle = {}],
  } = await db.query(
    `select me.outcome, me.crowns,
            (select max(o.crowns) from battle_participant o
              where o.battle_id = me.battle_id and o.side <> me.side)
              as crowns_against
       from battle_participant me
      where me.battle_id = $1 and me.player_tag = $2`,
    [h.battle_id, h.player_tag],
  );
  const key = battlePostKey(h.post_id);
  const ledgerId = newLedgerId();
  const content = battlePostContent({
    name: h.name,
    playerTag: h.player_tag,
    words: h.words,
    battle,
    url: postUrl(h.share_id),
  });
  const at = new Date(now);
  await db.query(
    `update account_post
        set clan_discord_at = $2, clan_discord_clan = $3
      where post_id = $1::bigint`,
    [h.post_id, at, h.clan_tag],
  );
  await aside(db, "battle_post_clan", () =>
    recordPosts(db, [
      {
        post_id: ledgerId,
        feature: "clan_activity",
        account_id: accountId,
        clan_tag: h.clan_tag,
        destination: row.channel_id,
        webhook_fp: row.webhook_fp,
        post_key: key,
        revision: 1,
        action: "post",
        mode: "code",
        items: [{ id: h.item_id, kind: "battle_highlight" }],
        content,
        event_at: h.updated_at ?? h.created_at,
        observed_at: h.updated_at ?? h.created_at,
        handed_at: at,
      },
    ]),
  );
  // Written last, inside the transaction: a failed write rolls the mark
  // back, and the key keeps a repeated hand-off to one post.
  await outbox(
    "timeline-discord",
    {
      v: 1,
      kind: "clan_activity",
      account_id: row.channel_id,
      webhook: row.webhook_sealed,
      posts: [{ key, revision: 1, content, ledger_id: ledgerId }],
    },
    { id: `post-${h.post_id}`, once: true },
  );
  return { status: 200, posted_at: at.toISOString(), already: false };
}
