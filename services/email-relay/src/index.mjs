/** Lambda entrypoint: the non-VPC JMAP relay. */

import { makeJmapSender } from './jmap.mjs';
import { makeHandler } from './handler.mjs';

export const handler = makeHandler({
  send: makeJmapSender({
    token: process.env.JMAP_TOKEN,
    fromEmail: process.env.FROM_EMAIL ?? 'elixir@poapkings.com',
  }),
});
