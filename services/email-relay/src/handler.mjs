/**
 * SQS consumer Lambda (non-VPC — the one component with internet egress).
 * Two message families with deliberately different semantics: email
 * retries hard (malformed → DLQ path, transport failures retry);
 * analytics pings are best-effort and DROP on any failure — a
 * Tinylytics outage must never fill the email DLQ or page anyone.
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
          if (!validated.ok) {
            outcome = "bad_message";
          } else {
            const { subject, text } = renderEmail(validated.msg);
            await send({ to: validated.msg.to, subject, text });
            // Mailing list (Drop's model): a login email only ever goes
            // to an APPROVED account, so its send is the enrollment
            // moment — the list mirrors people who actually sign in.
            // Best-effort AFTER the send: an enrollment failure must
            // never retry the batch (that would resend the login email)
            // and Buttondown's own unsubscribe state is never fought —
            // an existing address (HTTP 400) is left exactly as it is.
            if (validated.msg.kind === "login" && enroll) {
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
