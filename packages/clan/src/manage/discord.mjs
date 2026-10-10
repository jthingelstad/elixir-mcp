/**
 * Actions in the clan's Discord (Jamie, 2026-10-10). A leader or
 * co-leader pastes a Discord webhook in Clan settings; each Action that
 * leaders or elders can take is then posted there as its line and a link
 * to its page, and the same message is edited when the Action closes, to
 * say how and by whom (`discordActionMessage` in the engine).
 *
 * The webhook:
 *  - is checked by posting through it (a short "connected" message) before
 *    it is kept; a refusal keeps nothing;
 *  - is kept sealed (AES-256-GCM under a key derived from the app's
 *    sealing secret for this use only, bound to the clan) in its own item,
 *    outside the clan's index, and is never shown again: leaders see the
 *    webhook's name in Discord, its id's last digits, who connected it;
 *  - stops being used when Discord says it is gone or refused; Settings
 *    says so, and connecting it again starts over.
 *
 * Posting: `share(clanTag)` runs after every request that can raise or
 * decide an Action (inside the clan's lock) and after the morning run.
 * It collects the relay's answers to earlier requests (the message id an
 * edit needs), then posts each open Action without a message, oldest
 * first and at most `PER_SWEEP` at a time, and edits each message whose
 * Action now reads differently. An Action that closes before it was ever
 * posted is not posted. A post whose outcome is unknown is never made
 * again; an edit can be, since it says the same thing twice.
 */

import {
  discordActionMessage,
  discordShareable,
} from "@elixir-mcp/clan-engine";
import { createBox } from "../sealed.mjs";
import { parseWebhook } from "../discord-webhook.mjs";
import { DISCORD_REQUEST_LIFETIME_MS } from "../discord-bridge.mjs";
import { ManageError } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
/** Posts and edits handed to the relay in one sweep; the rest wait. */
export const PER_SWEEP = 10;
/** A post Discord asked us to slow down for is tried this many times. */
const POST_TRIES = 3;
/** Answers that mean the webhook itself no longer works. */
const DEAD = new Set(["webhook_gone", "webhook_refused"]);

const bound = (clanTag) => `discord|${clanTag}`;

/** What a leader reads when Discord refuses, by the relay's code. */
function refusal(code) {
  if (DEAD.has(code))
    return new ManageError(400, "webhook_refused", null, {
      message:
        "Discord did not accept that webhook. Copy it again from the channel's Integrations settings.",
    });
  if (code === "rate_limited")
    return new ManageError(429, "discord_busy", null, {
      message: "Discord asked us to slow down. Try again in a minute.",
    });
  return new ManageError(502, "discord_unavailable", null, {
    message:
      "Discord did not answer in time. Check the channel before trying again: the connected message may have arrived.",
  });
}

export function createDiscordService({
  ledger,
  bridge,
  secret,
  appUrl = "https://elixir.poapkings.com/clan",
  /** How long a leader's request may wait for Discord, in ms */
  waitMs = () => 20_000,
  now = () => Date.now(),
  log = console,
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

  /** Settle the relay's answer to one post or edit into its item. */
  async function settle(clanTag, post, stored) {
    let reply;
    try {
      reply = await bridge.reply(post.request_id);
    } catch {
      return post;
    }
    if (reply === null) {
      if (now() - Date.parse(post.requested_at) < DISCORD_REQUEST_LIFETIME_MS)
        return post;
      // Never answered: the relay never took it, or stopped mid-call.
      reply = { ok: false, code: "outcome_unknown" };
    }
    const next = {
      ...post,
      request_id: null,
      requested_at: null,
      pending_kind: null,
      pending_text: null,
    };
    if (reply.ok) {
      next.shown = post.pending_text;
      if (post.pending_kind === "post") next.message_id = reply.message_id;
      next.error = null;
    } else {
      next.error = reply.code ?? "discord_error";
      if (DEAD.has(reply.code))
        await ledger.saveDiscordWebhook(clanTag, {
          ...stored,
          refused_at: iso(),
          refused_code: reply.code,
        });
      // An edit Discord refuses outright (the message was deleted there,
      // say) is let go; one it may not have seen is tried again.
      if (
        post.pending_kind === "edit" &&
        ![
          "rate_limited",
          "outcome_unknown",
          "expired",
          "discord_error",
          "outbox_refused",
        ].includes(reply.code)
      )
        next.gone = true;
      // A post that may have arrived is never made again.
      if (post.pending_kind === "post" && reply.code !== "rate_limited")
        next.gave_up = !["expired", "outbox_refused"].includes(reply.code);
    }
    await ledger.saveDiscordPost(clanTag, next);
    return next;
  }

  async function hand(clanTag, url, card, existing, text) {
    const kind = existing?.message_id ? "edit" : "post";
    const r = await bridge.send({
      method: kind,
      url,
      content: text,
      ...(kind === "edit" ? { message_id: existing.message_id } : {}),
    });
    if (!r.ok) return false;
    await ledger.saveDiscordPost(clanTag, {
      card_id: card.card_id,
      number: card.number ?? null,
      message_id: existing?.message_id ?? null,
      shown: existing?.shown ?? null,
      tries: (existing?.tries ?? 0) + (kind === "post" ? 1 : 0),
      request_id: r.id,
      requested_at: iso(),
      pending_kind: kind,
      pending_text: text,
      error: null,
    });
    return true;
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
        posted: posts.filter((p) => p.message_id).length,
        waiting: posts.filter((p) => p.request_id).length,
      };
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
      const sent = await bridge.send({
        method: "post",
        url: hook.url,
        content: `Elixir Clan will post ${clanName ?? clanTag}'s Actions here, and mark each one when it is done.\n<${actionsLink(clanTag)}>`,
      });
      if (!sent.ok) throw refusal("outbox_unavailable");
      const reply = await bridge.wait(sent.id, waitMs());
      if (!reply.ok) throw refusal(reply.code);
      await ledger.removeDiscordWebhook(clanTag);
      await ledger.saveDiscordWebhook(clanTag, {
        sealed: box.seal(hook.url, bound(clanTag)),
        hint: `webhook …${hook.id.slice(-4)}`,
        name: reply.name ?? null,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: iso(),
        refused_at: null,
      });
      return { ok: true, name: reply.name ?? null };
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
      const byCard = new Map();
      for (const post of await ledger.discordPosts(clanTag)) {
        const settled = post.request_id
          ? await settle(clanTag, post, stored)
          : post;
        byCard.set(settled.card_id, settled);
      }
      if ((await ledger.discordWebhook(clanTag))?.refused_at)
        return { shared: 0, reason: "refused" };
      const cards = (await ledger.cards(clanTag))
        .filter(discordShareable)
        .sort(
          (a, b) =>
            (a.number ?? Infinity) - (b.number ?? Infinity) ||
            String(a.raised_at).localeCompare(String(b.raised_at)),
        );
      let handed = 0;
      for (const card of cards) {
        if (handed >= PER_SWEEP) break;
        const post = byCard.get(card.card_id);
        if (post?.request_id || post?.gone || post?.gave_up) continue;
        const text = discordActionMessage(card, {
          clanTag,
          appUrl,
        });
        if (post?.message_id) {
          if (post.shown === text) continue;
        } else if (
          card.status !== "proposed" ||
          (post?.tries ?? 0) >= POST_TRIES
        )
          continue;
        if (!(await hand(clanTag, url, card, post, text))) {
          log.error?.("clan_discord_handoff_failed");
          break;
        }
        handed++;
      }
      return { shared: handed };
    },
  };
}
