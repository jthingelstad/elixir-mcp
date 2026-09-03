/** Lambda entrypoint for the MCP door (elixir.poapkings.com). */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { makeHandler } from './handler.mjs';

const sqs = new SQSClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  issuer: process.env.OAUTH_ISSUER ?? 'https://elixir.poapkings.com',
  sendLoginEmail: ({ email, code, clientName }) =>
    sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.EMAIL_QUEUE_URL,
        MessageBody: JSON.stringify({ v: 1, kind: 'login', to: email, code, client_name: clientName }),
      }),
    ),
});
