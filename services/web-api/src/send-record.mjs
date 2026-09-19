/**
 * One sent email, read for the console: the ledger row and, when the
 * archive has it, the mail as it was sent (services/jobs/src/email/
 * archive.mjs). Two readers share it, the way call-record.mjs is shared:
 * the person's own record (/api/me/email/sends/<id>, own sends only)
 * and the maintainer's (/api/admin/email/sends/<id>, every account),
 * so a report filed about an email opens the same body on both sides
 * (Jamie, 2026-09-19: "then the maintainer team has all info").
 */
import { KIND_LABELS } from "@elixir-mcp/mail";
import { readSentMail } from "../../jobs/src/email/archive.mjs";

/** The Tinylytics pixel, removed from an archived body before the
 *  console shows it: opens are counted per mail, and a person reading
 *  their own record (or a maintainer reading theirs) is not an open. */
function stripPixel(html) {
  return String(html ?? "").replace(
    /<img[^>]+tinylytics\.app\/pixel\/[^>]*>/g,
    "",
  );
}

export const SENDS_COLS = `s.send_id, s.issue_id, s.account_id, s.enqueued_at, s.archived,
         coalesce(s.subject, i.subject_line) as subject,
         i.kind, i.period_key, i.status`;
export const SENDS_FROM = `from email_send s join email_issue i on i.issue_id = s.issue_id`;
export const SENDS_SQL = `select ${SENDS_COLS} ${SENDS_FROM}`;

export const sendRow = (r) => ({
  send_id: r.send_id,
  kind: r.kind,
  label: KIND_LABELS[r.kind] ?? r.kind,
  subject: r.subject,
  period: r.period_key,
  sent_at: r.enqueued_at,
  archived: r.archived,
});

/** The record, or null when there is no such send (for this account,
 *  when one is named). The body rides when archived and a store is
 *  configured; a store that cannot read it back says archive_error and
 *  the row still answers. */
export async function loadSendRecord(
  db,
  { sendId, accountId = null, archive = null },
) {
  const params = [sendId];
  let where = `s.send_id = $1`;
  if (accountId) {
    params.push(accountId);
    where += ` and s.account_id = $2`;
  }
  const { rows } = await db.query(`${SENDS_SQL} where ${where}`, params);
  const row = rows[0];
  if (!row) return null;
  const out = { send: sendRow(row), html: null, text: null };
  if (row.archived && archive) {
    try {
      const body = await readSentMail({
        store: archive,
        at: row.enqueued_at,
        sendId,
      });
      out.html = stripPixel(body.html);
      out.text = body.text ?? null;
      out.archived_at = body.archived_at ?? null;
    } catch (err) {
      console.error("mail_archive_read_failed", sendId, err?.message);
      out.archive_error = true;
    }
  }
  return out;
}
