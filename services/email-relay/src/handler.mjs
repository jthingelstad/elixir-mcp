/**
 * SQS consumer Lambda (non-VPC — the one component with internet egress).
 * Malformed messages go to the DLQ path; transport failures retry.
 */

import { validateEmailMessage } from '@elixir-mcp/contracts';
import { renderEmail } from './templates.mjs';

export function makeHandler({ send }) {
  return async function handler(event) {
    const batchItemFailures = [];
    for (const record of event.Records ?? []) {
      let outcome = 'sent';
      try {
        const parsed = JSON.parse(record.body);
        const validated = validateEmailMessage(parsed);
        if (!validated.ok) {
          outcome = 'bad_message';
        } else {
          const { subject, text } = renderEmail(validated.msg);
          await send({ to: validated.msg.to, subject, text });
        }
      } catch {
        outcome = 'retry';
      }
      if (outcome !== 'sent') batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  };
}
