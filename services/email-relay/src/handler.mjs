/**
 * SQS consumer Lambda (non-VPC — the one component with internet egress).
 * Two message families with deliberately different semantics: email
 * retries hard (malformed → DLQ path, transport failures retry);
 * analytics pings are best-effort and DROP on any failure — a
 * Tinylytics outage must never fill the email DLQ or page anyone.
 *
 * Owner notifications (owner_notify) ride the best-effort lane too
 * (decided 2026-09-09): one send attempt, a log line on failure, never a
 * batch item failure. The thing they announce - a feedback row, an access
 * request, a raised hand - is durable in the database and visible in the
 * console either way, and the daily Close the Loop pass reads that table;
 * a lost courtesy email is recoverable, a DLQ full of them pages for
 * nothing and shares the alarm with sign-in mail, which must retry hard.
 */

import {
  validateEmailMessage,
  isAnalyticsEventMessage,
} from "@elixir-mcp/contracts";
import { renderEmail } from "./templates.mjs";

export function makeHandler({ send, track = null, enroll = null }) {
  return async function handler(event) {
    const batchItemFailures = [];
    const analytics = [];
    for (const record of event.Records ?? []) {
      let outcome = "sent";
      try {
        const parsed = JSON.parse(record.body);
        if (parsed?.kind === "tinylytics_event") {
          // Invalid analytics drops silently — pings never dead-letter.
          if (isAnalyticsEventMessage(parsed)) analytics.push(parsed);
        } else {
          const validated = validateEmailMessage(parsed);
          if (parsed?.kind === "owner_notify") {
            // Best-effort: sent once or dropped with a log line.
            if (!validated.ok) {
              console.error("owner_notify_drop", validated.errors.join(","));
            } else {
              try {
                const { subject, text, html } = renderEmail(validated.msg);
                await send({ to: validated.msg.to, subject, text, html });
              } catch (err) {
                console.error("owner_notify_drop", err?.message);
              }
            }
          } else if (!validated.ok) {
            outcome = "bad_message";
          } else {
            const { subject, text, html } = renderEmail(validated.msg);
            await send({ to: validated.msg.to, subject, text, html });
            // Mailing list: enrollment rides a login send, but only
            // when the ACCOUNT opted in — the enqueuing VPC Lambda has
            // the database and stamps msg.newsletter (issue #27).
            // Signing in is not an affirmative marketing choice, so an
            // unflagged login enrolls nothing. Best-effort AFTER the
            // send: an enrollment failure must never retry the batch
            // (that would resend the login email) and Buttondown's own
            // unsubscribe state is never fought.
            if (
              validated.msg.kind === "login" &&
              validated.msg.newsletter &&
              enroll
            ) {
              try {
                await enroll(validated.msg.to);
              } catch (err) {
                console.error("buttondown_drop", err?.message);
              }
            }
          }
        }
      } catch {
        outcome = "retry";
      }
      if (outcome !== "sent")
        batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    if (track && analytics.length > 0) {
      try {
        await track(analytics);
      } catch (err) {
        console.error("tinylytics_drop", analytics.length, err?.message);
      }
    }
    return { batchItemFailures };
  };
}
