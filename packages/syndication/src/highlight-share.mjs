/** A shared highlight, posted in its player's clan's Discord (social
 *  slice 9, #767; Jamie, 2026-11-12: "a shared post can post to the
 *  clan's Discord through Clan's webhook").
 *
 *  Only by its owner's own act, once, and only where the clan's leaders
 *  allow it:
 *  - the highlight's posting account asks (nobody else's request finds
 *    it), the highlight is shared already (its link is public, so the
 *    post makes nothing public that was not), and the account still
 *    holds a verified claim on its player;
 *  - the player is a current member of a clan whose activity channel
 *    (Clan ▸ Social ▸ Discord) is connected and on, with the clan's
 *    policy saved and "Shared highlights" turned on by a leader (off by
 *    default: `activityCategories`);
 *  - once per highlight (0254): a second ask sends nothing.
 *
 *  The message goes the way every clan activity post goes: an outbox
 *  object on the timeline-discord/ lane, kind `clan_activity`, with the
 *  channel's webhook still sealed as the row keeps it; the relay opens
 *  it, posts with `allowed_mentions: { parse: [] }` and SUPPRESS_EMBEDS,
 *  never repeats a post whose outcome is unknown, and answers in a
 *  receipt to the quality ledger row written here (discord_post). The
 *  key is the highlight's own, so even a duplicate hand-off is one post.
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

/** The relay's key for this highlight's post: one per highlight, in the
 *  form its lane takes (`tl_` and 20 hex). */
export const highlightPostKey = (highlightId) =>
  `tl_${createHash("sha256")
    .update(`highlight-clan:${highlightId}`)
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
export function highlightPostContent({ name, playerTag, words, battle, url }) {
  const who = escapeDiscord(String(name ?? "").trim()) || playerTag;
  const lines = [`**${who}** shared a highlight: ${battleWords(battle)}`];
  const said = escapeDiscord(String(words ?? "").trim()).trim();
  // Typographic quotes open the line, so nothing typed can lead it as a
  // heading, a list or a subtext.
  if (said) lines.push(`> “${said}”`);
  return withLink(lines.join("\n"), url);
}

const fail = (status, error, message) => ({ status, error, message });

/** The highlight as this account may post it, with its player's clan and
 *  battle; null when it is not the account's. */
async function readOwn(db, accountId, highlightId, lock = false) {
  const {
    rows: [h],
  } = await db.query(
    `select h.highlight_id, h.player_tag, h.battle_id, h.words, h.share_id,
            h.created_at, h.updated_at, h.clan_discord_at, h.clan_discord_clan,
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
       from battle_highlight h
       left join player p on p.player_tag = h.player_tag
      where h.highlight_id = $1 and h.account_id = $2
      ${lock ? "for update of h" : ""}`,
    [highlightId, accountId],
  );
  return h ?? null;
}

/** The clan's channel when it takes shared highlights now, else null. */
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

/** What the battle page shows its owner for one highlight: whether it may
 *  go to the clan's Discord now, and when it went. Never the clan's
 *  webhook or settings beyond that yes or no. */
export async function highlightClanDiscord(
  db,
  accountId,
  highlightId,
  { policyFor },
) {
  const h = await readOwn(db, accountId, highlightId);
  if (!h) return null;
  if (h.clan_discord_at)
    return { available: false, posted_at: h.clan_discord_at.toISOString() };
  const ready =
    h.verified && Boolean(await openChannel(db, h.clan_tag, policyFor));
  return { available: ready, posted_at: null };
}

/**
 * Post the highlight in its player's clan's Discord: the owner's act.
 * `outbox(lane, body, opts)` is the outbox writer; `policyFor(db, tag)`
 * the clan's saved policy. Answers `{ status, posted_at, already }` or a
 * refusal `{ status, error, message }`.
 */
export async function postHighlightToClan(
  db,
  accountId,
  highlightId,
  { outbox, policyFor, now = Date.now() },
) {
  if (!outbox)
    return fail(503, "unavailable", "Discord posting is not set up.");
  await db.query("begin");
  try {
    const out = await post(db, accountId, highlightId, {
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

async function post(db, accountId, highlightId, { outbox, policyFor, now }) {
  const h = await readOwn(db, accountId, highlightId, true);
  if (!h) return fail(404, "not_found", "No such highlight.");
  if (h.clan_discord_at)
    return {
      status: 200,
      posted_at: h.clan_discord_at.toISOString(),
      already: true,
    };
  if (!h.share_id) return fail(409, "not_shared", "Share the highlight first.");
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
      "Your clan's leaders have not turned on shared highlights in its Discord.",
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
  const key = highlightPostKey(h.highlight_id);
  const ledgerId = newLedgerId();
  const content = highlightPostContent({
    name: h.name,
    playerTag: h.player_tag,
    words: h.words,
    battle,
    url: postUrl(h.share_id),
  });
  const at = new Date(now);
  await db.query(
    `update battle_highlight
        set clan_discord_at = $2, clan_discord_clan = $3
      where highlight_id = $1`,
    [h.highlight_id, at, h.clan_tag],
  );
  await aside(db, "highlight_clan", () =>
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
        items: [
          { id: `highlight:${h.highlight_id}`, kind: "battle_highlight" },
        ],
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
    { id: `highlight-${h.highlight_id}`, once: true },
  );
  return { status: 200, posted_at: at.toISOString(), already: false };
}
