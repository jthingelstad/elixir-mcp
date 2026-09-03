/**
 * Fastmail JMAP send — librarian's jmap-mail pattern written fresh and
 * small: session discovery, identity + drafts-mailbox lookup (cached per
 * warm start), then one request creating the Email and its
 * EmailSubmission. Injectable fetch; the token comes from config, never
 * read here.
 */

const SESSION_URL = 'https://api.fastmail.com/jmap/session';
const MAIL = 'urn:ietf:params:jmap:mail';
const SUBMISSION = 'urn:ietf:params:jmap:submission';

export function makeJmapSender({ token, fromEmail, fetchImpl = fetch }) {
  let cached; // { apiUrl, accountId, identityId, draftsId }

  async function call(apiUrl, methodCalls) {
    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ using: [MAIL, SUBMISSION], methodCalls }),
    });
    if (!res.ok) throw new Error(`JMAP call failed: HTTP ${res.status}`);
    return (await res.json()).methodResponses;
  }

  async function bootstrap() {
    if (cached) return cached;
    const res = await fetchImpl(SESSION_URL, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`JMAP session failed: HTTP ${res.status}`);
    const session = await res.json();
    const accountId = session.primaryAccounts?.[MAIL];
    if (!accountId) throw new Error('JMAP session has no mail account');
    const responses = await call(session.apiUrl, [
      ['Identity/get', { accountId }, 'i'],
      ['Mailbox/query', { accountId, filter: { role: 'drafts' } }, 'm'],
    ]);
    const identities = responses.find(([name]) => name === 'Identity/get')?.[1]?.list ?? [];
    const identity = identities.find((i) => i.email?.toLowerCase() === fromEmail.toLowerCase());
    if (!identity) throw new Error(`no JMAP identity for ${fromEmail}`);
    const draftsId = responses.find(([name]) => name === 'Mailbox/query')?.[1]?.ids?.[0];
    if (!draftsId) throw new Error('no drafts mailbox');
    cached = { apiUrl: session.apiUrl, accountId, identityId: identity.id, draftsId };
    return cached;
  }

  return async function send({ to, subject, text }) {
    const { apiUrl, accountId, identityId, draftsId } = await bootstrap();
    const responses = await call(apiUrl, [
      [
        'Email/set',
        {
          accountId,
          create: {
            draft: {
              mailboxIds: { [draftsId]: true },
              from: [{ email: fromEmail, name: 'Elixir MCP' }],
              to: [{ email: to }],
              subject,
              bodyValues: { body: { value: text } },
              textBody: [{ partId: 'body', type: 'text/plain' }],
            },
          },
        },
        'e',
      ],
      [
        'EmailSubmission/set',
        {
          accountId,
          create: { send: { emailId: '#draft', identityId } },
          onSuccessDestroyEmail: ['#send'],
        },
        's',
      ],
    ]);
    const created = responses.find(([name]) => name === 'EmailSubmission/set')?.[1]?.created?.send;
    if (!created) {
      const err = responses.find(([name]) => name === 'EmailSubmission/set')?.[1]?.notCreated;
      throw new Error(`JMAP submission failed: ${JSON.stringify(err ?? responses)}`);
    }
    return { sent: true };
  };
}
