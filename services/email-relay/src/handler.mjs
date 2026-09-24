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
 * console either way, and the daily Close the Loop pass reads that table;
 * a lost courtesy email is recoverable, a DLQ full of them pages for
 * nothing and shares the alarm with sign-in mail, which must retry hard.
 */

import {
  validateEmailMessage,
  unsubscribeHeaders,
  outboxObjects,
} from "@elixir-mcp/contracts";
import { renderEmail } from "./templates.mjs";

/** `readObject(obj)` returns the object's text, or null when it no longer
 *  exists; `deleteObject(obj)` removes it once it is sent. */
export function makeHandler({
  send,
  enroll = null,
  readObject = null,
  deleteObject = null,
}) {
  /** One message: "sent" (or dropped by design) or "bad_message"; a
   *  transport failure throws so the record retries. */
  async function deliver(parsed) {
    const validated = validateEmailMessage(parsed);
    if (parsed?.kind === "owner_notify") {
      // Best-effort: sent once or dropped with a log line.
      if (!validated.ok) {
        console.error("owner_notify_drop", validated.errors.join(","));
        return "sent";
      }
      try {
        const { subject, text, html } = renderEmail(validated.msg);
        await send({ to: validated.msg.to, subject, text, html });
      } catch (err) {
        console.error("owner_notify_drop", err?.message);
      }
      return "sent";
    }
    if (!validated.ok) return "bad_message";
    const { subject, text, html } = renderEmail(validated.msg);
    // The mail policy's other half: a bulk kind (none exist yet) gets its
    // one-click headers here; a transactional kind gets none. The
    // contract already refused the mismatches.
    const out = await send({
      to: validated.msg.to,
      subject,
      text,
      html,
      headers: unsubscribeHeaders(validated.msg),
    });
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
    // Mailing list: enrollment rides a login send, but only when the
    // ACCOUNT opted in — the sending VPC Lambda has the database and
    // stamps msg.newsletter (issue #27). Signing in is not an affirmative
    // marketing choice, so an unflagged login enrolls nothing.
    // Best-effort AFTER the send: an enrollment failure must never retry
    // the batch (that would resend the login email) and Buttondown's own
    // unsubscribe state is never fought.
    if (validated.msg.kind === "login" && validated.msg.newsletter && enroll) {
      try {
        await enroll(validated.msg.to);
      } catch (err) {
        console.error("buttondown_drop", err?.message);
      }
    }
    return "sent";
  }

  /** One queue record: the outbox objects it names, or the message it
   *  carries. */
  async function fromRecord(body) {
    const objects = outboxObjects(body);
    if (objects === null) return deliver(JSON.parse(body));
    // One object per notification; S3's own test event names none.
    for (const obj of objects) {
      const text = await readObject(obj);
      if (text === null) continue;
      const outcome = await deliver(JSON.parse(text));
      if (outcome !== "sent") return outcome;
      try {
        await deleteObject(obj);
      } catch (err) {
        // The bucket's lifecycle expires it; a duplicate notification
        // before then would send it again.
        console.error("outbox_delete_failed", err?.message);
      }
    }
    return "sent";
  }

  return async function handler(event) {
    const batchItemFailures = [];
    for (const record of event.Records ?? []) {
      let outcome;
      try {
        outcome = await fromRecord(record.body);
      } catch (err) {
        // The message goes back for a retry; the reason must be on the
        // record, or a broken transport is ten invocations of nothing
        // (2026-09-17, first SES send). Name and message only: never the
        // recipient, never a body.
        console.error("send_retry", err?.name ?? "Error", err?.message);
        outcome = "retry";
      }
      if (outcome !== "sent")
        batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  };
}
