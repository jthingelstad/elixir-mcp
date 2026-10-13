/**
 * SQS consumer Lambda (non-VPC — the one component with internet egress).
 * Email retries hard: a malformed message takes the DLQ path and a
 * transport failure retries.
 *
 * The VPC Lambdas hand mail over through the outbox (2026-09-24): they
 * write the message to the outbox bucket and S3 notifies this queue, so
 * a record names an object to read, send and delete. A failed object
 * stays in the bucket while its notification retries and dead-letters.
 * An object already gone was sent by an earlier copy of the same
 * notification (S3 delivers at least once) and is done. A message sent
 * straight to the queue is still accepted: that is an ops hand-send.
 *
 * Owner notifications (owner_notify) are best-effort (decided
 * 2026-09-09): one send attempt, a log line on failure, never a batch
 * item failure. The thing they announce - a feedback row, an access
 * request, a raised hand - is durable in the database and visible in the
 * console either way, and the daily feedback pass reads that table;
 * a lost courtesy email is recoverable, a DLQ full of them pages for
 * nothing and shares the alarm with sign-in mail, which must retry hard.
 */

import {
  validateEmailMessage,
  isRetiredEmailKind,
  unsubscribeHeaders,
  outboxObjects,
  NEWSLETTER_ENROLL,
} from "@elixir-mcp/contracts";
import { renderEmail } from "./templates.mjs";

/** The queue a record came from, by its ARN
 *  (arn:aws:sqs:<region>:<account>:<name>). */
export function queueUrlOf(arn) {
  const m = /^arn:aws:sqs:([a-z0-9-]+):(\d{12}):([A-Za-z0-9_-]+)$/.exec(
    String(arn ?? ""),
  );
  return m ? `https://sqs.${m[1]}.amazonaws.com/${m[2]}/${m[3]}` : null;
}

/** `readObject(obj)` returns the object's text, or null when it no longer
 *  exists; `deleteObject(obj)` removes it once it is sent. */
export function makeHandler({
  send,
  enroll = null,
  readObject = null,
  deleteObject = null,
  modelObject = null,
  discordObject = null,
  timelineDiscordObject = null,
  upgradeDelivery = null,
  /** `(record, seconds)`: hold a record back that long (SQS
   *  ChangeMessageVisibility), for a Discord lane that knows when to try
   *  again (2026-10-11). Without it the queue's own timeout stands. */
  defer = null,
  /** The Discord lanes' maxReceiveCount: the receive that reaches it is
   *  the last, and its worker records what it could not deliver. */
  discordMaxReceives = 5,
}) {
  /** One message: "sent" (or dropped by design) or "bad_message"; a
   *  transport failure throws so the record retries. */
  async function deliver(parsed) {
    if (isRetiredEmailKind(String(parsed?.kind ?? ""))) {
      console.log("mail_retired", parsed.kind);
      return "sent";
    }
    // An enrollment with no mail (2026-10-12): the jobs Lambda's
    // {newsletter_sync} hands over the address of an account that opted
    // in but has had no sign-in or welcome mail to enroll it. Enrolled as
    // a sign-in enrolls (an existing address, unsubscribed included, is
    // left alone); best-effort, with a log line either way.
    if (parsed?.kind === NEWSLETTER_ENROLL) {
      const to = typeof parsed.to === "string" ? parsed.to.trim() : "";
      if (!to.includes("@")) return "bad_message";
      if (!enroll) {
        console.error("newsletter_enroll_drop", "not_configured");
        return "sent";
      }
      try {
        await enroll(to, parsed.ip_address);
        console.log("newsletter_enrolled");
      } catch {
        console.error("newsletter_enroll_drop", "transport_error");
      }
      return "sent";
    }
    const validated = validateEmailMessage(parsed);
    if (parsed?.kind === "owner_notify") {
      // Best-effort: sent once or dropped with a log line.
      if (!validated.ok) {
        console.error("owner_notify_drop", "invalid_message");
        return "sent";
      }
      try {
        const { subject, text, html } = renderEmail(validated.msg);
        await send({ to: validated.msg.to, subject, text, html });
      } catch {
        console.error("owner_notify_drop", "transport_error");
      }
      return "sent";
    }
    if (!validated.ok) return "bad_message";
    const { subject, text, html } = renderEmail(validated.msg);
    // The mail policy's other half: a bulk kind (none exist yet) gets its
    // one-click headers here; a transactional kind gets none. The
    // contract already refused the mismatches.
    const guarded = validated.msg.issue_key?.startsWith("collector-upgrade/");
    let out;
    if (guarded) {
      if (!upgradeDelivery || !validated.msg.send_id)
        throw new Error("upgrade_delivery_not_configured");
      const state = await upgradeDelivery.claim(validated.msg.send_id);
      if (state === "sent") return "sent";
      if (state !== "claimed") {
        console.error(
          "collector_upgrade_delivery_uncertain",
          validated.msg.send_id,
        );
        throw new Error("upgrade_delivery_uncertain");
      }
    }
    try {
      out = await send({
        to: validated.msg.to,
        subject,
        text,
        html,
        headers: unsubscribeHeaders(validated.msg),
        ...(guarded ? { singleAttempt: true } : {}),
      });
    } catch (err) {
      // An explicit service rejection proves SES did not accept the mail.
      // Timeouts and connection losses prove neither success nor failure.
      if (
        guarded &&
        err?.$metadata?.httpStatusCode >= 400 &&
        err?.$metadata?.httpStatusCode < 500
      )
        await upgradeDelivery.release(validated.msg.send_id);
      throw err;
    }
    if (guarded)
      await upgradeDelivery.finish(
        validated.msg.send_id,
        out?.message_id ?? null,
      );
    // The one line that ties a sent product email to the transport: the
    // send id the footer shows, the issue it fulfils, the message id SES
    // assigned. Never the recipient.
    if (validated.msg.send_id)
      console.log(
        "mail_sent",
        validated.msg.kind,
        validated.msg.send_id,
        validated.msg.issue_key ?? "",
        out?.message_id ?? "",
      );
    // Mailing list: enrollment rides an approved login or verified welcome, but only when the
    // ACCOUNT opted in — the sending VPC Lambda has the database and
    // stamps msg.newsletter (issue #27). Signing in is not an affirmative
    // marketing choice, so an unflagged login enrolls nothing.
    // Best-effort AFTER the send: an enrollment failure must never retry
    // the batch (that would resend the login email) and Buttondown's own
    // unsubscribe state is never fought.
    if (
      ["login", "welcome"].includes(validated.msg.kind) &&
      validated.msg.newsletter &&
      enroll
    ) {
      try {
        await enroll(validated.msg.to, validated.msg.ip_address);
      } catch {
        console.error("buttondown_drop", "transport_error");
      }
    }
    return "sent";
  }

  /** One queue record: the outbox objects it names, or the message it
   *  carries. */
  async function fromRecord(body, final = false) {
    const objects = outboxObjects(body);
    if (objects === null) return deliver(JSON.parse(body));
    // One object per notification; S3's own test event names none.
    for (const obj of objects) {
      if (obj.key.startsWith("clan-model/")) {
        if (!modelObject) return "bad_message";
        await modelObject(obj);
        continue;
      }
      // Actions in a clan's Discord (2026-10-10): a post or an edit.
      if (obj.key.startsWith("clan-discord/")) {
        if (!discordObject) return "bad_message";
        await discordObject(obj);
        continue;
      }
      // The timeline cross-posted to Discord (2026-10-10): lines to post
      // or edit (packages/syndication/src/relay.mjs).
      if (obj.key.startsWith("timeline-discord/")) {
        if (!timelineDiscordObject) return "bad_message";
        await timelineDiscordObject(obj, { final });
        continue;
      }
      const text = await readObject(obj);
      if (text === null) continue;
      const outcome = await deliver(JSON.parse(text));
      if (outcome !== "sent") return outcome;
      try {
        await deleteObject(obj);
      } catch {
        // The bucket's lifecycle expires it; a duplicate notification
        // before then would send it again.
        console.error("outbox_delete_failed", "transport_error");
      }
    }
    return "sent";
  }

  return async function handler(event) {
    const batchItemFailures = [];
    for (const record of event.Records ?? []) {
      let outcome;
      const final =
        Number(record.attributes?.ApproximateReceiveCount ?? 0) >=
        discordMaxReceives;
      try {
        outcome = await fromRecord(record.body, final);
      } catch (err) {
        outcome = "retry";
        // A Discord lane that knows when to try again (a rate limit, its
        // pace) says so: the record comes back then, not after the
        // queue's six minutes. Its code is ours, never Discord's text.
        const afterMs = Number(err?.retryAfterMs);
        if (defer && Number.isFinite(afterMs) && afterMs > 0) {
          const seconds = Math.min(900, Math.max(1, Math.ceil(afterMs / 1000)));
          console.error("send_deferred", String(err.code ?? "retry"), seconds);
          try {
            await defer(record, seconds);
          } catch {
            console.error("send_defer_failed", "transport_error");
          }
          batchItemFailures.push({ itemIdentifier: record.messageId });
          continue;
        }
        // The message goes back for a retry. Transport errors are
        // untrusted and may include recipient or body data, so only a
        // bounded class reaches the log.
        console.error("send_retry", "transport_error");
      }
      if (outcome !== "sent")
        batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  };
}
