/** Render, enqueue, record: the one path every kind's send takes. */
import {
  renderMail,
  htmlToText,
  signUnsubscribe,
  unsubscribeUrl,
} from "@elixir-mcp/mail";
import { alreadySent, recordSend } from "./ledger.mjs";

const MANAGE_URL = "https://elixir.poapkings.com/account/profile";

export async function deliver({
  db,
  enqueue,
  secret,
  kind,
  issueId,
  issueKey,
  account,
  facts,
  force = false,
}) {
  if (!force && (await alreadySent(db, issueId, account.accountId)))
    return { sent: false, reason: "already_sent" };
  const token = signUnsubscribe({ secret, accountId: account.accountId, kind });
  const links = { unsubscribe: unsubscribeUrl(token), manage: MANAGE_URL };
  const { subject, html } = renderMail(kind, facts, links);
  const text = htmlToText(html);
  await enqueue({
    v: 1,
    kind,
    to: account.email,
    subject,
    text,
    html,
    issue_key: issueKey,
    unsubscribe: { url: links.unsubscribe },
  });
  await recordSend(db, issueId, account.accountId);
  return { sent: true, subject };
}
