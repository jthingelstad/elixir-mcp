/**
 * Plain-text email templates. Every message carries the disclaimer; the
 * login mail leads with the code (Apple Mail code detection reads the
 * early text) and includes the link for same-device flows.
 */

import { DISCLAIMER } from '@elixir-mcp/contracts';

const SIGNIN_BASE = 'https://elixir.poapkings.com/signin';

export function renderEmail(msg) {
  if (msg.kind === 'login') {
    const link = msg.token ? `${SIGNIN_BASE}?login_token=${msg.token}` : null;
    const consent = msg.client_name
      ? `Entering this code authorizes ${msg.client_name} to read your recorded Clash Royale data.\n\n`
      : '';
    return {
      subject: `${msg.code} is your Elixir MCP sign-in code`,
      text:
        `Your Elixir MCP sign-in code is ${msg.code}\n\n` +
        consent +
        (link ? `Or sign in with one click:\n${link}\n\n` : '') +
        `The code and link expire in 15 minutes. If you didn't request this, ignore it.\n\n` +
        `${DISCLAIMER}\n`,
    };
  }
  if (msg.kind === 'welcome') {
    return {
      subject: 'Your Elixir MCP access is approved',
      text:
        `You're in!\n\n` +
        `Sign in at https://elixir.poapkings.com/signin, claim your player tag, and turn on\n` +
        `recording. Then connect your agent to https://elixir.poapkings.com/mcp and start asking\n` +
        `questions the game itself can't answer.\n\n` +
        `${DISCLAIMER}\n`,
    };
  }
  if (msg.kind === 'owner_notify') {
    return {
      subject: 'Elixir MCP: new access request',
      text: `${msg.note ?? 'A new access request is waiting.'}\n\nReview: https://elixir.poapkings.com/admin\n`,
    };
  }
  throw new Error(`unknown email kind: ${msg.kind}`);
}
