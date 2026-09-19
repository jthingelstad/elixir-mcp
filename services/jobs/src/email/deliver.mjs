/** Render, archive, enqueue, record: the one path every kind's send takes.
 *
 *  Every send has its own id (send_id, 0139), minted here before the
 *  render so the mail's footer can carry it: the id is what a person
 *  quotes and what the relay logs beside SES's message id, so one sent
 *  email can be found in the log, opened in the console
 *  (/account/activity/emails) and reported on (Jamie, 2026-09-19). */
import { randomUUID } from "node:crypto";
import {
  renderMail,
  htmlToText,
  signUnsubscribe,
  unsubscribeUrl,
} from "@elixir-mcp/mail";
import { alreadySent, recordSend } from "./ledger.mjs";
import { archiveSentMail } from "./archive.mjs";

const MANAGE_URL = "https://elixir.poapkings.com/account/profile";

export async function deliver({
  db,
  enqueue,
  secret,
  kind,
  issueId,
  issueKey,
  period,
  account,
  facts,
  archive = null,
  force = false,
  now = new Date(),
}) {
  if (!force && (await alreadySent(db, issueId, account.accountId)))
    return { sent: false, reason: "already_sent" };
  const token = signUnsubscribe({ secret, accountId: account.accountId, kind });
  const sendId = randomUUID();
  const links = {
    unsubscribe: unsubscribeUrl(token),
    manage: MANAGE_URL,
    period,
    send_id: sendId,
  };
  const { subject, html } = renderMail(kind, facts, links);
  const text = htmlToText(html);
  const archived = await archiveSentMail({
    store: archive,
    sendId,
    at: now,
    kind,
    subject,
    html,
    text,
  });
  await enqueue({
    v: 1,
    kind,
    to: account.email,
    subject,
    text,
    html,
    issue_key: issueKey,
    send_id: sendId,
    unsubscribe: { url: links.unsubscribe },
  });
  await recordSend(db, issueId, account.accountId, {
    sendId,
    subject,
    archived,
    at: now,
  });
  return { sent: true, subject, send_id: sendId };
}
