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
 * never post one line twice, and an edit is recorded only over the
 * state it read.
 *
 * Discord saying the webhook is gone or refused writes `gone` to the
 * account's status, which the sync reads and turns cross-posting off;
 * the rest of the batch is dropped. Any other refusal writes `failing`
 * and drops the batch. The webhook arrives sealed and is opened only
 * here; logs name the account and the webhook's fingerprint.
 */
import {
  parseDiscordWebhook,
  validateTimelineDiscordMessage,
  webhookFingerprint,
  timelineDiscordStateKey,
  timelineDiscordStatusKey,
} from "@elixir-mcp/contracts";

/** A claim this old with no message id was a sender that stopped
 *  mid-call: its post's outcome is unknown, and it is never made again. */
const CLAIM_SETTLE_MS = 2 * 60_000;
const CONTENDED_TRIES = 4;
/** No new line is started past this in one run (the relay's timeout is
 *  60 s, and a 429 may be waited up to 10 s): the rest go back to the
 *  queue, and the lines already told are skipped next time. */
const BUDGET_MS = 35_000;
const DEAD = new Set(["webhook_gone", "webhook_refused"]);

/** Discord refused the batch: the webhook is gone, or this message. */
class Refused extends Error {
  constructor(gone, status) {
    super(gone ? "timeline_discord_gone" : "timeline_discord_refused");
    this.gone = gone;
    this.status = status;
  }
}
const retry = (code) => new Error(`timeline_discord_${code}`);

/**
 * @param {{
 *   discord: { post: Function, edit: Function },
 *   store: ReturnType<typeof import("./store.mjs").timelineDiscordStore>,
 *   open: (sealed: object, accountId: string, kind: string) => string | null,
 *   now?: () => number,
 *   log?: Pick<Console, "log" | "error">,
 * }} deps
 */
export function createTimelineDiscordWorker({
  discord,
  store,
  open,
  now = () => Date.now(),
  log = console,
  budgetMs = BUDGET_MS,
}) {
  const claim = (revision) => ({ pending: true, revision, at: now() });

  /** One line: "posted", "edited", "skipped" or "unknown". */
  async function deliverPost(url, key, post) {
    for (let i = 0; i < CONTENDED_TRIES; i += 1) {
      const cur = await store.read(key);
      const state = cur?.body ?? null;
      // Never again: a post whose outcome was unknown, or a line deleted
      // in the channel.
      if (state?.unknown || state?.deleted) return "skipped";
      if (state?.message_id) {
        if (state.revision >= post.revision) return "skipped";
        const r = await discord.edit(url, state.message_id, post.content);
        if (!r.ok) {
          if (DEAD.has(r.code)) throw new Refused(true, r.status);
          if (r.code === "message_gone") {
            if (await store.replace(key, { ...state, deleted: true }, cur.etag))
              return "skipped";
            continue;
          }
          if (r.code === "bad_request") throw new Refused(false, r.status);
          throw retry(r.code);
        }
        if (
          await store.replace(
            key,
            { message_id: state.message_id, revision: post.revision },
            cur.etag,
          )
        )
          return "edited";
        continue;
      }
      if (state?.pending) {
        if (now() - state.at < CLAIM_SETTLE_MS) throw retry("post_in_flight");
        // The sender that claimed it stopped mid-call.
        if (
          await store.replace(
            key,
            { unknown: true, revision: post.revision },
            cur.etag,
          )
        )
          return "unknown";
        continue;
      }
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
        return "posted";
      }
      // Refused outright: Discord did not take it, so it may be sent again.
      if (
        r.code === "rate_limited" ||
        DEAD.has(r.code) ||
        r.code === "bad_request"
      ) {
        await store.remove(key).catch(() => {});
        if (r.code === "rate_limited") throw retry("rate_limited");
        throw new Refused(DEAD.has(r.code), r.status);
      }
      await store.replace(
        key,
        { unknown: true, revision: post.revision },
        etag,
      );
      return "unknown";
    }
    throw retry("state_contended");
  }

  /** One timeline-discord/ outbox object: every line, in order. Throws
   *  to send the notification back for a retry. */
  return async function work(obj) {
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
    const counts = { posted: 0, edited: 0, skipped: 0, unknown: 0 };
    let refused = null;
    const status = (state, extra = {}) =>
      store.put(timelineDiscordStatusKey(msg.account_id), {
        state,
        webhook: fingerprint,
        at: new Date(now()).toISOString(),
        ...extra,
      });
    const started = now();
    try {
      for (const post of msg.posts) {
        if (now() - started > budgetMs) throw retry("time_budget");
        const key = timelineDiscordStateKey(
          msg.account_id,
          fingerprint,
          post.key,
        );
        counts[await deliverPost(hook.url, key, post)] += 1;
      }
    } catch (err) {
      if (!(err instanceof Refused)) throw err;
      refused = err;
      await status(err.gone ? "gone" : "failing", {
        http_status: err.status,
        posted: counts.posted,
        edited: counts.edited,
      });
      log.error(
        "timeline_discord_refused",
        msg.account_id,
        fingerprint,
        err.gone ? "gone" : "refused",
        err.status,
      );
    }
    if (!refused && (counts.posted || counts.edited))
      await status("ok", { posted: counts.posted, edited: counts.edited });
    log.log(
      "timeline_discord",
      msg.account_id,
      fingerprint,
      msg.kind,
      counts.posted,
      counts.edited,
      counts.skipped,
      counts.unknown,
    );
    await store.deleteObject(obj).catch(() => {
      // The lifecycle expires it; a duplicate notification before then
      // finds every line already told and skips it.
      log.error("outbox_delete_failed", "transport_error");
    });
  };
}
