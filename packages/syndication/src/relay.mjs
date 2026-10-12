/**
 * The timeline's posts, delivered to Discord by the relay (the non-VPC
 * email relay, the one component with internet egress, which also
 * carries Clan's Actions). The VPC sync writes a batch of lines to the
 * outbox's timeline-discord/ lane; S3 notifies the relay's queue; each
 * line is posted to the account's webhook, or, when it was posted before
 * at a lower revision, that message is edited in place.
 *
 * The rules are Clan's (2026-10-10): no mentions, no previews; a 429 is
 * Discord saying it did NOT take the message, so it is the one refusal
 * retried; a post whose outcome is unknown (a timeout, a lost
 * connection, a 5xx) is never made again, since a duplicate line is
 * worse than a missing one. An edit says the same thing twice and may be
 * retried. A line deleted in the channel stays deleted.
 *
 * The message id of each post lives beside the outbox, under
 * timeline-discord-state/<account>/<webhook fingerprint>/<item>.json,
 * written with S3's conditional writes: a post is claimed before it is
 * sent, so two copies of a notification (S3 delivers at least once)
 * never post one line twice, and an edit is claimed the same way
 * (2026-10-11, #454), so an older revision's edit never lands after a
 * newer one's.
 *
 * Pace (2026-10-11): one webhook's lines are spaced SPACING_MS apart
 * across every run and every destination that shares the webhook (its
 * pace record, timeline-discord-state/pace/<fingerprint>), which keeps a big
 * clan's war-day burst under Discord's ~30 messages a minute per channel;
 * the client also waits out the webhook's own X-RateLimit budget. A line
 * that has to wait longer than the run may goes back to the queue with
 * the wait (`retryAfterMs`, which the relay's handler turns into the
 * message's visibility), not the queue's six minutes.
 *
 * Refusals: Discord saying the webhook is gone or refused writes `gone`
 * to the status, and a forum channel's webhook (which takes no plain
 * message) writes `forum`; the sync reads either and turns the posting
 * off, and the rest of the batch is dropped. Discord refusing one line
 * for anything else (a 400) skips that line alone, with Discord's reason
 * in the delivery history, and the rest are still delivered (2026-10-11).
 * On the queue's last attempt a line still waiting is recorded as not
 * delivered rather than vanishing into the dead-letter queue.
 *
 * The history (contracts DiscordDeliveryHistory: the last 20 deliveries
 * and the count not delivered over 30 days) sits beside the status for
 * the page that set the webhook up. A clan's activity channel keeps its
 * last 40, with the stories it skipped and why (2026-10-11): a message's
 * `skipped` list is recorded once the message is done, never sent. The webhook arrives sealed and is
 * opened only here; logs name the account and the webhook's fingerprint.
 *
 * Receipts (2026-10-11, the quality ledger, 0222): a post that carries
 * its ledger row's id is answered in a receipt, written to the outbox's
 * discord-receipt/ lane once the run is done (and before a retry, for
 * the posts already answered), which the timeline sync reads into the
 * ledger. Best effort: a receipt never holds up or fails a delivery.
 */
import {
  parseDiscordWebhook,
  validateTimelineDiscordMessage,
  webhookFingerprint,
  timelineDiscordStateKey,
  timelineDiscordPaceKey,
  timelineDiscordStatusKey,
  timelineDiscordHistoryKey,
  addDiscordDeliveries,
  isClanDiscordKind,
  DISCORD_CLAN_HISTORY_MAX,
  DISCORD_HISTORY_MAX,
} from "@elixir-mcp/contracts";

/** A claim this old with no message id was a sender that stopped
 *  mid-call: its post's outcome is unknown, and it is never made again.
 *  An edit claimed this long ago may be made again. */
const CLAIM_SETTLE_MS = 2 * 60_000;
const CONTENDED_TRIES = 4;
/** No new line is started past this in one run (the relay's timeout is
 *  60 s, and a 429 may be waited up to 10 s): the rest go back to the
 *  queue, and the lines already told are skipped next time. */
const BUDGET_MS = 35_000;
/** One webhook's calls at most this often: 25 a minute, under Discord's
 *  ~30 messages a minute for one channel. */
export const SPACING_MS = 2_400;
const DEAD = new Set(["webhook_gone", "webhook_refused"]);
/** Receipts in one discord-receipt/ object: a message's 20 lines fit. */
const RECEIPTS_PER_OBJECT = 50;
/** A receipt's words for a line the relay did not send. */
const NOT_SENT_AGAIN = {
  told: "Already told at this revision.",
  deleted: "Deleted in the channel.",
  unknown_before: "An earlier delivery's outcome is unknown.",
  refused_before: "Discord refused this revision before.",
  editing: "Another delivery is editing it.",
};
/** Why a line still waiting at the queue's last attempt was not sent. */
const NOT_SENT = {
  rate_limited: "Discord kept asking Elixir to slow down.",
  paced: "Too many lines at once for one channel.",
  time_budget: "Too many lines at once for one channel.",
  post_in_flight: "Another delivery of this line never finished.",
  edit_in_flight: "Another edit of this line never finished.",
  discord_error: "Discord did not answer.",
  outcome_unknown: "Discord did not answer.",
  state_contended: "Too many deliveries of this line at once.",
};

/** Discord refused the webhook itself: it is gone, or a forum's. */
class Refused extends Error {
  constructor(state, status, reason = null) {
    super(`timeline_discord_${state}`);
    this.state = state;
    this.status = status;
    this.reason = reason;
  }
}
/** Not now: the line goes back to the queue, after `retryAfterMs`. */
export class RetryLater extends Error {
  constructor(code, afterMs = null) {
    super(`timeline_discord_${code}`);
    this.code = code;
    this.retryAfterMs = Number.isFinite(afterMs)
      ? Math.max(1000, Math.ceil(afterMs))
      : null;
  }
}
const retry = (code, afterMs) => new RetryLater(code, afterMs);

/**
 * @param {{
 *   discord: { post: Function, edit: Function },
 *   store: ReturnType<typeof import("./store.mjs").timelineDiscordStore>,
 *   open: (sealed: object, accountId: string, kind: string) => string | null,
 *   now?: () => number,
 *   pause?: (ms: number) => Promise<void>,
 *   log?: Pick<Console, "log" | "error">,
 *   receipt?: ((body: { v: 1, receipts: object[] }) => Promise<unknown>) | null,
 * }} deps
 */
export function createTimelineDiscordWorker({
  discord,
  store,
  open,
  now = () => Date.now(),
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console,
  budgetMs = BUDGET_MS,
  spacingMs = SPACING_MS,
  receipt = null,
}) {
  const claim = (revision) => ({ pending: true, revision, at: now() });

  /** Wait for this webhook's next turn, shared by every run through the
   *  pace record; a turn past `until` goes back to the queue instead. */
  async function pace(paceKey, until) {
    for (let i = 0; i < CONTENDED_TRIES; i += 1) {
      const cur = await store.read(paceKey);
      const slot = Math.max(now(), Number(cur?.body?.next_at) || 0);
      if (slot > until) throw retry("paced", slot - now());
      const body = { next_at: slot + spacingMs };
      const etag = cur
        ? await store.replace(paceKey, body, cur.etag)
        : await store.create(paceKey, body);
      if (!etag) continue;
      if (slot > now()) await pause(slot - now());
      return;
    }
    throw retry("state_contended", 1000);
  }

  /** A line not sent, and why (the receipt's reason): told at this
   *  revision already, deleted in the channel, an unknown outcome or a
   *  refusal before, or another run editing it. */
  const skippedFor = (why) => ({ outcome: "skipped", why });

  /** One line: { outcome: posted | edited | skipped | unknown | refused,
   *  status?, reason?, why?, deleted? }. Throws Refused (the webhook) or
   *  RetryLater. */
  async function deliverPost(url, key, post, paceKey, until) {
    for (let i = 0; i < CONTENDED_TRIES; i += 1) {
      const cur = await store.read(key);
      const state = cur?.body ?? null;
      // Never again: a post whose outcome was unknown, or a line deleted
      // in the channel.
      if (state?.unknown) return skippedFor("unknown_before");
      if (state?.deleted) return skippedFor("deleted");
      if (state?.message_id) {
        if (state.revision >= post.revision) return skippedFor("told");
        const told = { message_id: state.message_id, revision: state.revision };
        const editing = state.editing;
        if (editing && now() - editing.at < CLAIM_SETTLE_MS) {
          // Another run is editing it: to this revision or a newer one,
          // this one has nothing to add; an older one, wait for it.
          if (editing.revision >= post.revision) return skippedFor("editing");
          throw retry("edit_in_flight", CLAIM_SETTLE_MS - (now() - editing.at));
        }
        await pace(paceKey, until);
        const etag = await store.replace(
          key,
          { ...told, editing: { revision: post.revision, at: now() } },
          cur.etag,
        );
        if (!etag) continue;
        const r = await discord.edit(url, state.message_id, post.content);
        if (r.ok) {
          // Over our own claim; a newer claim over a stale one of ours
          // keeps its own.
          await store.replace(
            key,
            { message_id: state.message_id, revision: post.revision },
            etag,
          );
          return { outcome: "edited" };
        }
        if (r.code === "message_gone") {
          await store.replace(key, { ...told, deleted: true }, etag);
          return { ...skippedFor("deleted"), deleted: true };
        }
        if (r.code === "bad_request") {
          // Discord will not take this text: the message keeps the last
          // one, and this revision is not tried again.
          await store.replace(
            key,
            { message_id: state.message_id, revision: post.revision },
            etag,
          );
          return { outcome: "refused", status: r.status, reason: r.reason };
        }
        await store.replace(key, told, etag).catch(() => {});
        if (DEAD.has(r.code)) throw new Refused("gone", r.status, r.reason);
        throw retry(r.code, r.retry_after_ms);
      }
      if (state?.pending) {
        const age = now() - state.at;
        if (age < CLAIM_SETTLE_MS)
          throw retry("post_in_flight", CLAIM_SETTLE_MS - age);
        // The sender that claimed it stopped mid-call.
        if (
          await store.replace(
            key,
            { unknown: true, revision: post.revision },
            cur.etag,
          )
        )
          return { outcome: "unknown" };
        continue;
      }
      // Refused before at this revision or a newer one: not again.
      if (state?.refused && state.revision >= post.revision)
        return skippedFor("refused_before");
      await pace(paceKey, until);
      const etag = cur
        ? await store.replace(key, claim(post.revision), cur.etag)
        : await store.create(key, claim(post.revision));
      if (!etag) continue;
      const r = await discord.post(url, post.content);
      if (r.ok && r.message_id) {
        // Over our own claim; a failed write here leaves the claim to
        // settle as unknown, never a second post.
        await store.replace(
          key,
          { message_id: String(r.message_id), revision: post.revision },
          etag,
        );
        return { outcome: "posted" };
      }
      // Refused outright: Discord did not take it, so it may be sent again.
      if (r.code === "rate_limited") {
        await store.remove(key).catch(() => {});
        throw retry("rate_limited", r.retry_after_ms);
      }
      if (DEAD.has(r.code) || r.code === "forum_needs_thread") {
        await store.remove(key).catch(() => {});
        throw new Refused(
          r.code === "forum_needs_thread" ? "forum" : "gone",
          r.status,
          r.reason,
        );
      }
      if (r.code === "bad_request") {
        // This line alone: a newer revision of it may be posted.
        await store.replace(
          key,
          { refused: true, revision: post.revision },
          etag,
        );
        return { outcome: "refused", status: r.status, reason: r.reason };
      }
      await store.replace(
        key,
        { unknown: true, revision: post.revision },
        etag,
      );
      return { outcome: "unknown" };
    }
    throw retry("state_contended", 1000);
  }

  /** What a delivery is about: the line's key and text, and whether the
   *  clan's own model wrote it. */
  const about = (post) =>
    post
      ? {
          ref: post.key,
          excerpt: post.content,
          ...(post.rewritten === true ? { rewritten: true } : {}),
          ...(post.ledger_id ? { ledger_id: post.ledger_id } : {}),
        }
      : {};

  /** Send this run's receipts; best effort, never fails the run. */
  async function sendReceipts(accountId, list) {
    if (!receipt || list.length === 0) return;
    try {
      for (let i = 0; i < list.length; i += RECEIPTS_PER_OBJECT)
        await receipt({
          v: 1,
          receipts: list.slice(i, i + RECEIPTS_PER_OBJECT),
        });
    } catch {
      log.error("timeline_discord_receipt_failed", accountId);
    }
  }

  /** Record this run's deliveries; best effort, never fails the run. */
  async function remember(accountId, added, max = DISCORD_HISTORY_MAX) {
    if (added.length === 0) return;
    const key = timelineDiscordHistoryKey(accountId);
    try {
      for (let i = 0; i < CONTENDED_TRIES; i += 1) {
        const cur = await store.read(key);
        const body = addDiscordDeliveries(cur?.body ?? null, added, now(), max);
        const ok = cur
          ? await store.replace(key, body, cur.etag)
          : await store.create(key, body);
        if (ok) return;
      }
      log.error("timeline_discord_history_contended", accountId);
    } catch {
      log.error("timeline_discord_history_failed", accountId);
    }
  }

  /** One timeline-discord/ outbox object: every line, in order. Throws
   *  to send the notification back for a retry (RetryLater says when);
   *  on the queue's last attempt (`final`) the lines still waiting are
   *  recorded as not delivered instead. */
  return async function work(obj, { final = false } = {}) {
    if (!obj.key.startsWith("timeline-discord/"))
      throw retry("unsupported_object");
    const text = await store.readObject(obj);
    // Gone: an earlier copy of this notification delivered it.
    if (text === null) return;
    const validated = validateTimelineDiscordMessage(JSON.parse(text));
    if (!validated.ok) {
      log.error("timeline_discord_bad_message", validated.errors.join(","));
      throw retry("bad_message");
    }
    const msg = validated.msg;
    // A clan's channel is sealed under its own purpose (`kind` says
    // which box opens it).
    const hook = parseDiscordWebhook(
      open(msg.webhook, msg.account_id, msg.kind),
    );
    if (!hook) {
      log.error("timeline_discord_unsealed", msg.account_id);
      throw retry("bad_message");
    }
    const fingerprint = webhookFingerprint(hook.url);
    // Paced by the webhook alone: two destinations may share one.
    const paceKey = timelineDiscordPaceKey(fingerprint);
    const counts = { posted: 0, edited: 0, skipped: 0, unknown: 0, refused: 0 };
    const added = [];
    const receipts = [];
    const answer = (post, outcome, extra = {}) => {
      if (post?.ledger_id)
        receipts.push({
          ledger_id: post.ledger_id,
          outcome,
          at: at(),
          ...extra,
        });
    };
    const at = () => new Date(now()).toISOString();
    let lastRefusal = null;
    const status = (state, extra = {}) =>
      store.put(timelineDiscordStatusKey(msg.account_id), {
        state,
        webhook: fingerprint,
        at: at(),
        ...extra,
      });
    const keep = isClanDiscordKind(msg.kind)
      ? DISCORD_CLAN_HISTORY_MAX
      : DISCORD_HISTORY_MAX;
    // The stories a clan's channel chose not to post: recorded when the
    // message is done (a retry would list them twice otherwise).
    const skips = () =>
      (msg.skipped ?? []).map((k) => ({
        at: at(),
        outcome: "skipped",
        ref: k.key,
        reason: k.reason,
        ...(k.excerpt ? { excerpt: k.excerpt } : {}),
        ...(k.rewritten === true ? { rewritten: true } : {}),
        ...(k.ledger_id ? { ledger_id: k.ledger_id } : {}),
      }));
    const started = now();
    const until = started + budgetMs;
    let next = 0;
    try {
      for (; next < msg.posts.length; next += 1) {
        const post = msg.posts[next];
        if (now() > until) throw retry("time_budget", 1000);
        const key = timelineDiscordStateKey(
          msg.account_id,
          fingerprint,
          post.key,
        );
        const r = await deliverPost(hook.url, key, post, paceKey, until);
        counts[r.outcome] += 1;
        answer(post, r.outcome === "skipped" ? "unchanged" : r.outcome, {
          ...(r.status ? { http_status: r.status } : {}),
          ...(r.reason || r.why
            ? { reason: r.reason ?? NOT_SENT_AGAIN[r.why] ?? r.why }
            : {}),
          ...(r.deleted ? { deleted: true } : {}),
        });
        if (r.outcome === "skipped") continue;
        added.push({
          at: at(),
          outcome: r.outcome,
          ...about(post),
          ...(r.status ? { http_status: r.status } : {}),
          ...(r.reason ? { reason: r.reason } : {}),
        });
        if (r.outcome === "refused") {
          lastRefusal = r;
          log.error(
            "timeline_discord_line_refused",
            msg.account_id,
            fingerprint,
            r.status,
          );
        }
      }
    } catch (err) {
      if (err instanceof Refused) {
        await status(err.state, {
          http_status: err.status,
          posted: counts.posted,
          edited: counts.edited,
          ...(err.reason ? { reason: err.reason } : {}),
        });
        added.push({
          at: at(),
          outcome: "refused",
          ...about(msg.posts[next]),
          http_status: err.status,
          reason:
            err.reason ??
            (err.state === "forum"
              ? "This webhook posts to a forum channel."
              : "Discord says this webhook no longer exists."),
        });
        answer(msg.posts[next], "refused", {
          http_status: err.status,
          reason: err.reason ?? err.state,
        });
        for (const post of msg.posts.slice(next + 1))
          answer(post, "not_delivered", {
            reason: "The webhook was refused; the rest were not sent.",
          });
        await remember(msg.account_id, [...added, ...skips()], keep);
        await sendReceipts(msg.account_id, receipts);
        log.error(
          "timeline_discord_refused",
          msg.account_id,
          fingerprint,
          err.state,
          err.status,
        );
        await finish(obj);
        return;
      }
      if (!(err instanceof RetryLater) || !final) {
        await remember(msg.account_id, added, keep);
        await sendReceipts(msg.account_id, receipts);
        throw err;
      }
      // The queue's last attempt: what is still waiting is not delivered.
      for (const post of msg.posts.slice(next)) {
        const reason = NOT_SENT[err.code] ?? "Elixir could not deliver it.";
        added.push({
          at: at(),
          outcome: "not_delivered",
          ...about(post),
          reason,
        });
        answer(post, "not_delivered", { reason });
      }
      log.error(
        "timeline_discord_not_delivered",
        msg.account_id,
        fingerprint,
        msg.posts.length - next,
        err.code,
      );
    }
    if (lastRefusal)
      await status("failing", {
        http_status: lastRefusal.status,
        posted: counts.posted,
        edited: counts.edited,
        ...(lastRefusal.reason ? { reason: lastRefusal.reason } : {}),
      });
    else if (counts.posted || counts.edited)
      await status("ok", { posted: counts.posted, edited: counts.edited });
    await remember(msg.account_id, [...added, ...skips()], keep);
    await sendReceipts(msg.account_id, receipts);
    log.log(
      "timeline_discord",
      msg.account_id,
      fingerprint,
      msg.kind,
      counts.posted,
      counts.edited,
      counts.skipped,
      counts.unknown,
      counts.refused,
    );
    await finish(obj);
  };

  async function finish(obj) {
    await store.deleteObject(obj).catch(() => {
      // The lifecycle expires it; a duplicate notification before then
      // finds every line already told and skips it.
      log.error("outbox_delete_failed", "transport_error");
    });
  }
}
