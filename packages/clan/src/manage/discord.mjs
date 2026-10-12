/**
 * Actions in the clan's Discord (Jamie, 2026-10-10). A leader or
 * co-leader pastes a Discord webhook in Clan settings; each Action that
 * leaders or elders can take is then posted there as its line and a link
 * to its page, and the same message is edited when the Action closes, to
 * say how and by whom (`discordActionMessage` in the engine).
 *
 * The webhook:
 *  - is checked by posting through it (a short "connected" message) before
 *    it is kept; a refusal keeps nothing, and says what Discord said;
 *  - is kept sealed (AES-256-GCM under a key derived from the app's
 *    sealing secret for this use only, bound to the clan) in its own item,
 *    outside the clan's index, and is never shown again: leaders see the
 *    webhook's name in Discord, its id's last digits, who connected it;
 *  - may be a forum channel's (2026-10-11): each Action is then a forum
 *    post of its own, named for it, and its close is an edit inside it;
 *    or one thread's (`?thread_id=`), where every Action goes;
 *  - stops being used when Discord says it is gone or refused; Settings
 *    says so, and connecting it again starts over.
 *
 * Posting: `share(clanTag)` runs after every request that can raise or
 * decide an Action (inside the clan's lock), after the morning run, and
 * a minute after each hand-off (a `wake`, 2026-10-11), so a close is
 * edited within minutes rather than at the next request. It collects the
 * relay's answers to the last hand-off, then hands over the next: every
 * open Action without a message and every message whose Action now
 * reads differently, in Action number order, at most `PER_SWEEP` in ONE
 * request, and only when the last one is answered, so a clan's Discord
 * reads in order and at Discord's pace. An Action that closes before it
 * was ever posted is not posted. A post whose outcome is unknown is never
 * made again; an edit can be, since it says the same thing twice.
 *
 * The request's id is kept on its Actions BEFORE the request is in the
 * outbox (#453): a stop between the two leaves a request no relay saw,
 * answered unknown an hour on, never a second post.
 *
 * A leader may name one Discord role to mention on each new Action
 * (Jamie, 2026-10-11, opt in); an edit never mentions anyone.
 *
 * What happened is kept for Settings: the last 20 deliveries in 30 days
 * (posted, edited, refused with Discord's words, unknown, not delivered).
 *
 * And for Elixir's operators, in the quality ledger (0222, `quality`,
 * injected by the service that shares): each post or edit as handed over
 * and, once settled, what Discord answered. An attempt Discord never saw
 * keeps its row and is handed over again under it.
 */
import { randomUUID } from "node:crypto";

import {
  discordActionMessage,
  discordActionTitle,
  discordShareable,
} from "@elixir-mcp/clan-engine";
import {
  addDiscordDeliveries,
  discordNotDelivered,
  webhookFingerprint,
} from "@elixir-mcp/contracts";
import { createBox } from "../sealed.mjs";
import { parseWebhook, validRoleId } from "../discord-webhook.mjs";
import { DISCORD_REQUEST_LIFETIME_MS } from "../discord-bridge.mjs";
import { ManageError, rateWith, ratingsOf } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
/** Posts and edits handed to the relay in one request; the rest wait. */
export const PER_SWEEP = 10;
/** A post Discord asked us to slow down for is tried this many times. */
const POST_TRIES = 3;
/** Answers that mean the webhook itself no longer works. */
const DEAD = new Set(["webhook_gone", "webhook_refused"]);
/** Answers that mean Discord never saw the call: tried again. */
const NOT_SEEN = new Set([
  "rate_limited",
  "expired",
  "not_sent",
  "outbox_refused",
]);
/** An unanswered hand-off is looked at again on a wake while this young. */
const WAKE_WHILE_MS = 10 * 60_000;

const bound = (clanTag) => `discord|${clanTag}`;

/** What a leader reads when Discord refuses, by the relay's answer. */
function refusal(reply) {
  const code = reply?.code;
  if (DEAD.has(code))
    return new ManageError(400, "webhook_refused", null, {
      message:
        "Discord did not accept that webhook. Copy it again from the channel's Integrations settings.",
    });
  if (code === "rate_limited")
    return new ManageError(429, "discord_busy", null, {
      message: "Discord asked us to slow down. Try again in a minute.",
    });
  if (code === "bad_request" || code === "forum_needs_thread")
    return new ManageError(400, "discord_refused", null, {
      message: `Discord refused the connected message${reply.reason ? `: ${reply.reason}` : "."}`,
    });
  return new ManageError(502, "discord_unavailable", null, {
    message:
      "Discord did not answer in time. Check the channel before trying again: the connected message may have arrived.",
  });
}

/** One settled post or edit, as Settings lists it, or null while it is
 *  still to be tried. */
function delivery(post, reply, at, triesLeft) {
  const base = {
    at,
    ref: Number.isInteger(post.number) ? `#${post.number}` : null,
    excerpt: post.pending_text,
    ...(post.ledger_open ? { ledger_id: post.ledger_open } : {}),
  };
  if (reply.ok)
    return {
      ...base,
      outcome: post.pending_kind === "post" ? "posted" : "edited",
    };
  if (reply.code === "outcome_unknown") return { ...base, outcome: "unknown" };
  if (NOT_SEEN.has(reply.code) || reply.code === "discord_error")
    return triesLeft ? null : { ...base, outcome: "not_delivered" };
  return {
    ...base,
    outcome: "refused",
    ...(reply.status ? { http_status: reply.status } : {}),
    reason: reply.reason ?? reply.code ?? null,
  };
}

export function createDiscordService({
  ledger,
  bridge,
  secret,
  appUrl = "https://elixir.poapkings.com/clan",
  /** How long a leader's request may wait for Discord, in ms */
  waitMs = () => 20_000,
  /** Look again in a minute (`share` from the timeline sync's queue). */
  wake = null,
  now = () => Date.now(),
  log = console,
  /** The quality ledger (syndication `discordQuality`), or null. */
  quality = null,
  /** A leader's ratings of the posts (2026-10-11), filed as feedback by
   *  the host: `{ rate({ feature, clanTag, postId, rating, note }),
   *  mine(postIds) }`, or null. */
  ratings = null,
}) {
  if (!secret) throw new Error("the Discord service needs the app secret");
  const box = createBox(secret, "clan discord webhook v1");
  const iso = () => new Date(now()).toISOString();
  const requireLeader = (who) => {
    if (!LEADERS.has(who.role) || who.verified === false)
      throw new ManageError(403, "leaders_only");
  };
  const actionsLink = (clanTag) =>
    `${appUrl.replace(/\/$/, "")}/${clanTag.replace(/^#/, "")}/actions`;

  async function remember(clanTag, added) {
    if (!added.length) return;
    try {
      const history = addDiscordDeliveries(
        (await ledger.discordLog(clanTag)) ?? null,
        added,
        now(),
      );
      await ledger.saveDiscordLog(clanTag, history);
    } catch {
      // The history is for reading; delivery never waits on it.
      log.error?.("clan_discord_history_failed");
    }
  }

  async function nudge(clanTag) {
    if (!wake) return;
    try {
      await wake(clanTag);
    } catch {
      log.error?.("clan_discord_wake_failed");
    }
  }

  /** Settle the relay's answers to the last hand-off into their items. */
  async function settleAll(clanTag, posts, stored) {
    const replies = new Map();
    const added = [];
    const receipts = [];
    let refused = null;
    let forum = null;
    const out = [];
    for (const post of posts) {
      if (!post.request_id) {
        out.push(post);
        continue;
      }
      if (!replies.has(post.request_id)) {
        let reply;
        try {
          reply = await bridge.reply(post.request_id);
        } catch {
          reply = undefined;
        }
        replies.set(post.request_id, reply);
        // What the request's read-backs found, once per request.
        for (const read of Array.isArray(reply?.reads) ? reply.reads : [])
          receipts.push({
            ledger_id: read.ref,
            at: Number.isFinite(read.at)
              ? new Date(read.at).toISOString()
              : iso(),
            present: read.present === true,
            ...(read.present
              ? { reactions: read.reactions ?? null, thread: read.thread }
              : {}),
          });
      }
      const whole = replies.get(post.request_id);
      if (whole === undefined) {
        out.push(post);
        continue;
      }
      let reply = whole;
      if (reply !== null && Array.isArray(reply.results))
        reply = reply.results[post.op] ?? {
          ok: false,
          code: "outcome_unknown",
        };
      if (reply === null) {
        if (
          now() - Date.parse(post.requested_at) <
          DISCORD_REQUEST_LIFETIME_MS
        ) {
          out.push(post);
          continue;
        }
        // Never answered: the relay never took it, or stopped mid-call.
        reply = { ok: false, code: "outcome_unknown" };
      }
      const next = {
        ...post,
        request_id: null,
        requested_at: null,
        op: null,
        pending_kind: null,
        pending_text: null,
      };
      if (reply.ok) {
        next.shown = post.pending_text;
        if (post.pending_kind === "post") {
          next.message_id = reply.message_id;
          next.thread_id = reply.thread_id ?? null;
          if (reply.forum) forum = true;
        }
        next.error = null;
      } else {
        next.error = reply.code ?? "discord_error";
        if (DEAD.has(reply.code)) refused = reply.code;
        // An edit Discord refuses outright (the message was deleted there,
        // say) is let go; one it may not have seen is tried again.
        if (
          post.pending_kind === "edit" &&
          !NOT_SEEN.has(reply.code) &&
          !["outcome_unknown", "discord_error"].includes(reply.code)
        )
          next.gone = true;
        // A post that may have arrived is never made again.
        if (post.pending_kind === "post" && reply.code !== "rate_limited")
          next.gave_up = !NOT_SEEN.has(reply.code);
      }
      const triesLeft =
        post.pending_kind === "edit"
          ? !next.gone
          : !next.gave_up && (next.tries ?? 0) < POST_TRIES;
      const entry = delivery(post, reply, iso(), triesLeft);
      if (entry) {
        added.push(entry);
        if (post.ledger_open)
          receipts.push({
            ledger_id: post.ledger_open,
            outcome: entry.outcome,
            at: entry.at,
            ...(entry.http_status ? { http_status: entry.http_status } : {}),
            ...(entry.reason ? { reason: entry.reason } : {}),
            ...(reply.code === "message_gone" ? { deleted: true } : {}),
          });
        next.ledger_open = null;
      }
      await ledger.saveDiscordPost(clanTag, next);
      out.push(next);
    }
    if (refused || (forum && !stored.forum))
      await ledger.saveDiscordWebhook(clanTag, {
        ...stored,
        ...(forum ? { forum: true } : {}),
        ...(refused ? { refused_at: iso(), refused_code: refused } : {}),
      });
    await remember(clanTag, added);
    if (quality && receipts.length) await quality.settle(receipts);
    return out;
  }

  return {
    /** For the Actions page's nudge: is the clan's Discord connected? */
    async summary(clanTag) {
      const stored = await ledger.discordWebhook(clanTag);
      return { set: Boolean(stored), refused: Boolean(stored?.refused_at) };
    },

    /** What leaders see: never the address. */
    async status(clanTag, who) {
      requireLeader(who);
      const stored = await ledger.discordWebhook(clanTag);
      if (!stored) return { clan_tag: clanTag, set: false };
      const posts = await ledger.discordPosts(clanTag);
      const history = (await ledger.discordLog(clanTag)) ?? null;
      return {
        clan_tag: clanTag,
        set: true,
        name: stored.name ?? null,
        hint: stored.hint,
        set_by: stored.set_by,
        set_by_name: stored.set_by_name ?? null,
        set_at: stored.set_at,
        readable: box.open(stored.sealed, bound(clanTag)) !== null,
        refused_at: stored.refused_at ?? null,
        forum: stored.forum === true,
        mention_role: stored.mention_role ?? null,
        posted: posts.filter((p) => p.message_id).length,
        waiting: posts.filter((p) => p.request_id).length,
        deliveries: history?.entries ?? [],
        not_delivered: discordNotDelivered(history, now()),
        ratings: await ratingsOf(ratings, history?.entries),
      };
    },

    /** A leader's thumbs up or down on one delivered Action, with an
     *  optional note: feedback about that post, to Elixir. */
    async rate(clanTag, who, body = {}) {
      requireLeader(who);
      return rateWith(ratings, "clan_actions", clanTag, body);
    },

    /**
     * Connect (or replace) the clan's webhook: a "connected" message is
     * posted through it first, and it is kept only when Discord took that.
     * Replacing it starts the messages over in the new channel.
     */
    async setWebhook(clanTag, who, { url, clanName = null } = {}) {
      requireLeader(who);
      const hook = parseWebhook(url);
      if (!hook)
        throw new ManageError(400, "not_a_webhook", null, {
          message:
            "A Discord webhook address starts https://discord.com/api/webhooks/.",
        });
      const text = `Elixir Clan will post ${clanName ?? clanTag}'s Actions here, and mark each one when it is done.\n<${actionsLink(clanTag)}>`;
      const sent = await bridge.send({
        method: "post",
        url: hook.url,
        content: text,
        // A forum channel takes this as a post of its own.
        thread_name: "Elixir Clan Actions",
      });
      if (!sent.ok) throw refusal({ code: "outbox_unavailable" });
      const reply = await bridge.wait(sent.id, waitMs());
      if (!reply.ok) throw refusal(reply);
      const previous = await ledger.discordWebhook(clanTag);
      await ledger.removeDiscordWebhook(clanTag);
      await ledger.saveDiscordWebhook(clanTag, {
        sealed: box.seal(hook.url, bound(clanTag)),
        hint: `webhook …${hook.id.slice(-4)}${hook.thread_id ? ` (thread …${hook.thread_id.slice(-4)})` : ""}`,
        name: reply.name ?? null,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: iso(),
        refused_at: null,
        forum: reply.forum === true,
        // The webhook's id (not its token) says whether it is the same
        // webhook, so the same server: only then does a role chosen
        // before stay. Another webhook may be another server, where that
        // role is nothing; a leader sets it again.
        webhook_id: hook.id,
        mention_role:
          previous?.webhook_id === hook.id
            ? (previous?.mention_role ?? null)
            : null,
      });
      await remember(clanTag, [
        { at: iso(), outcome: "posted", ref: null, excerpt: text },
      ]);
      return {
        ok: true,
        name: reply.name ?? null,
        forum: reply.forum === true,
      };
    },

    /** The one role each new Action mentions, or null for none. */
    async setMentionRole(clanTag, who, { role_id = null } = {}) {
      requireLeader(who);
      const stored = await ledger.discordWebhook(clanTag);
      if (!stored)
        throw new ManageError(400, "discord_not_connected", null, {
          message: "Connect the clan's Discord first.",
        });
      const role = role_id === null || role_id === "" ? null : String(role_id);
      if (role !== null && !validRoleId(role))
        throw new ManageError(400, "not_a_role", null, {
          message:
            "A role's id is a long number: in Discord, Server Settings › Roles, right-click the role › Copy Role ID (Developer Mode on).",
        });
      await ledger.saveDiscordWebhook(clanTag, {
        ...stored,
        mention_role: role,
      });
      return { ok: true, mention_role: role };
    },

    /** Stop posting. Messages already in Discord stay there. */
    async removeWebhook(clanTag, who) {
      requireLeader(who);
      await ledger.removeDiscordWebhook(clanTag);
      return { ok: true };
    },

    /** Bring the clan's Discord up to date with its Actions. */
    async share(clanTag) {
      const stored = await ledger.discordWebhook(clanTag);
      if (!stored || stored.refused_at) return { shared: 0 };
      const url = box.open(stored.sealed, bound(clanTag));
      if (!url) return { shared: 0, reason: "unreadable" };
      const posts = await settleAll(
        clanTag,
        await ledger.discordPosts(clanTag),
        stored,
      );
      const current = await ledger.discordWebhook(clanTag);
      if (current?.refused_at) return { shared: 0, reason: "refused" };
      // One hand-off at a time: the next waits for this one's answers.
      const open = posts.filter((p) => p.request_id);
      if (open.length) {
        const young = open.some(
          (p) => now() - Date.parse(p.requested_at) < WAKE_WHILE_MS,
        );
        if (young) await nudge(clanTag);
        return { shared: 0, waiting: open.length };
      }
      const byCard = new Map(posts.map((p) => [p.card_id, p]));
      const cards = (await ledger.cards(clanTag))
        .filter(discordShareable)
        .sort(
          (a, b) =>
            (a.number ?? Infinity) - (b.number ?? Infinity) ||
            String(a.raised_at).localeCompare(String(b.raised_at)),
        );
      const mention = validRoleId(current?.mention_role)
        ? current.mention_role
        : null;
      const picked = [];
      for (const card of cards) {
        if (picked.length >= PER_SWEEP) break;
        const post = byCard.get(card.card_id);
        if (post?.gone || post?.gave_up) continue;
        const text = discordActionMessage(card, { clanTag, appUrl });
        if (post?.message_id) {
          if (post.shown === text) continue;
          picked.push({
            card,
            post,
            text,
            op: {
              method: "edit",
              message_id: post.message_id,
              ...(post.thread_id ? { thread_id: post.thread_id } : {}),
              content: text,
            },
          });
        } else if (
          card.status === "proposed" &&
          (post?.tries ?? 0) < POST_TRIES
        )
          picked.push({
            card,
            post,
            text,
            op: {
              method: "post",
              content: mention ? `<@&${mention}> ${text}` : text,
              thread_name: discordActionTitle(card),
              ...(mention ? { mention_role: mention } : {}),
            },
          });
      }
      if (!picked.length) return { shared: 0 };
      // The quality ledger's read-back rides the hand-off: up to three
      // Actions posted a day to a week ago, read after these ops.
      const reads = [];
      if (quality?.candidates)
        for (const c of await quality.candidates({
          destination: clanTag,
          webhook_fp: webhookFingerprint(url),
        })) {
          const post = byCard.get(c.key);
          if (post?.message_id)
            reads.push({
              ref: c.ledger_id,
              message_id: post.message_id,
              ...(post.thread_id ? { thread_id: post.thread_id } : {}),
            });
        }
      const prepared = bridge.prepare({
        url,
        ops: picked.map((p) => p.op),
        ...(reads.length ? { reads } : {}),
        ...(current?.forum ? { forum: true } : {}),
      });
      if (!prepared.ok) {
        log.error?.("clan_discord_handoff_failed");
        return { shared: 0, reason: prepared.code };
      }
      // The request's id is on its Actions before it is in the outbox.
      const at = iso();
      const rows = [];
      for (const [n, { card, post, text, op }] of picked.entries()) {
        const ledgerId = post?.ledger_open ?? randomUUID();
        rows.push({
          post_id: ledgerId,
          feature: "clan_actions",
          clan_tag: clanTag,
          destination: clanTag,
          webhook_fp: webhookFingerprint(url),
          post_key: card.card_id,
          revision: 0,
          action: op.method === "post" ? "post" : "edit",
          mode: "code",
          items: [{ id: card.card_id, kind: card.type ?? null }],
          content: op.content,
          event_at:
            op.method === "post"
              ? card.raised_at
              : (card.decided_at ?? card.withdrawn_at ?? card.raised_at),
          observed_at:
            op.method === "post"
              ? card.raised_at
              : (card.decided_at ?? card.withdrawn_at ?? null),
          handed_at: at,
        });
        await ledger.saveDiscordPost(clanTag, {
          card_id: card.card_id,
          number: card.number ?? null,
          message_id: post?.message_id ?? null,
          thread_id: post?.thread_id ?? null,
          shown: post?.shown ?? null,
          tries: (post?.tries ?? 0) + (op.method === "post" ? 1 : 0),
          request_id: prepared.id,
          op: n,
          requested_at: at,
          pending_kind: op.method,
          pending_text: text,
          error: null,
          ledger_open: ledgerId,
        });
      }
      if (quality) await quality.record(rows);
      const r = await bridge.publish(prepared);
      // Not in the outbox, or not known to be: the hour's wait answers it
      // unknown, so a post is never made twice.
      if (!r.ok) log.error?.("clan_discord_handoff_failed");
      else await nudge(clanTag);
      return { shared: r.ok ? picked.length : 0 };
    },
  };
}
