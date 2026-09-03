/**
 * The /mcp Lambda shape (API Gateway behind the no-cookie CloudFront on
 * mcp.poapkings.com). Bearer only — cookies structurally never arrive.
 * 401s carry WWW-Authenticate with resource_metadata (RFC 9728) so
 * clients can discover the authorization server.
 */

import pg from 'pg';
import { validateAccessToken, checkRateLimit } from '@elixir-mcp/auth';
import { handleMcpMessage } from './protocol.mjs';
import { makeRegistry } from './tools.mjs';
import { makeInvoker } from './invoker.mjs';
import { makeQuota } from './quota.mjs';

export const HOURLY_RATE_LIMIT = 300;

export function makeHandler({ databaseUrl, issuer = 'https://mcp.poapkings.com' }) {
  const registry = makeRegistry();
  const unauthorized = () => ({
    statusCode: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    },
    body: JSON.stringify({ error: 'invalid_token' }),
  });

  return async function handler(event) {
    if ((event.requestContext?.http?.method ?? event.httpMethod) !== 'POST') {
      return { statusCode: 405, headers: { allow: 'POST' }, body: '' };
    }
    const auth = String(event.headers?.authorization ?? event.headers?.Authorization ?? '');
    if (!auth.toLowerCase().startsWith('bearer ')) return unauthorized();

    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const account = await validateAccessToken(db, auth.slice(7).trim());
      if (!account) return unauthorized();
      const withinRate = await checkRateLimit(db, {
        bucket: `mcp#${account.accountId}`,
        max: HOURLY_RATE_LIMIT,
      });
      if (!withinRate) {
        return { statusCode: 429, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'rate_limited' }) };
      }
      let message;
      try {
        message = JSON.parse(event.body ?? '');
      } catch {
        return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'invalid_json' }) };
      }
      const result = await handleMcpMessage(message, {
        registry,
        spendQuota: makeQuota({ db, account }),
        invokeTool: makeInvoker({ db, account, registry }),
      });
      return {
        statusCode: result.statusCode,
        headers: { 'content-type': 'application/json' },
        body: result.payload === null ? '' : JSON.stringify(result.payload),
      };
    } finally {
      await db.end();
    }
  };
}
