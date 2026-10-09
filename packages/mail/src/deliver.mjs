import { isRetiredEmailKind } from "@elixir-mcp/contracts";
/** Render, archive, enqueue, record: the one path every kind's send takes.
 *
 *  Every send has its own id (send_id, 0139), minted here before the
 *  render so the mail's footer can carry it: the id is what a person
 *  quotes and what the relay logs beside SES's message id, so one sent
 *  email can be found in the log, opened in the console
 *  (/console/account/activity/emails) and reported on (Jamie, 2026-09-19). */
import { randomUUID } from "node:crypto";
import {
  renderMail,
  htmlToText,
  resolveCardArt,
  signUnsubscribe,
  unsubscribeUrl,
} from "@elixir-mcp/mail";
import { alreadySent, recordSend } from "./ledger.mjs";
import { archiveSentMail } from "./archive.mjs";

const MANAGE_URL = "https://elixir.poapkings.com/console/account/profile/email";

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
  sendId = randomUUID(),
  // (path) => whether the card-art mirror holds that file: an Evo or
  // Hero whose image it lacks draws the base card (resolveCardArt).
  // Null draws every card's own form.
  cardArt = null,
}) {
  if (isRetiredEmailKind(kind)) return { sent: false, reason: "retired" };
  if (!force && (await alreadySent(db, issueId, account.accountId)))
    return { sent: false, reason: "already_sent" };
  const token = signUnsubscribe({ secret, accountId: account.accountId, kind });
  const links = {
    unsubscribe: unsubscribeUrl(token),
    manage: MANAGE_URL,
    period,
    send_id: sendId,
    // A mail composed once for many readers names days in each one's zone,
    // and marks the reader's own players (the clan report's "you").
    timezone: account.timezone ?? "UTC",
    ...(account.tags?.length ? { mine: account.tags } : {}),
  };
  const drawn = cardArt ? await resolveCardArt(facts, cardArt) : facts;
  const { subject, html } = renderMail(kind, drawn, links);
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
