/** email_issue / email_send (0137): what was composed, who it went to.
 *  A send row is written AFTER the enqueue succeeds (write-after-send),
 *  so a re-run resends nothing the queue already has and a failed
 *  enqueue is retried by the next run. */

export async function upsertIssue(
  db,
  {
    kind,
    periodKey,
    subjectKey = "",
    facts = null,
    subjectLine = null,
    status = "composed",
    note = null,
  },
) {
  const { rows } = await db.query(
    `insert into email_issue (kind, period_key, subject_key, facts, subject_line, status, note)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (kind, period_key, subject_key) do update
       set facts = coalesce(excluded.facts, email_issue.facts),
           subject_line = coalesce(excluded.subject_line, email_issue.subject_line),
           status = excluded.status, note = excluded.note
     returning issue_id`,
    [
      kind,
      periodKey,
      subjectKey,
      facts ? JSON.stringify(facts) : null,
      subjectLine,
      status,
      note,
    ],
  );
  return rows[0].issue_id;
}

export async function alreadySent(db, issueId, accountId) {
  const { rows } = await db.query(
    `select 1 from email_send where issue_id = $1 and account_id = $2`,
    [issueId, accountId],
  );
  return rows.length > 0;
}

/** The send row carries the send's own id and subject (0139) so the
 *  console can list what was sent without opening the archive, and
 *  `archived` says whether the body landed there. `at` is the row's
 *  enqueued_at, the archive key's day. A re-send under force (the
 *  account page's "send me this now") is a NEW row: the primary key is
 *  the send id, and (issue, account) is what alreadySent reads. */
export async function recordSend(
  db,
  issueId,
  accountId,
  { sendId, subject = null, archived = false, at = new Date() } = {},
) {
  await db.query(
    `insert into email_send (send_id, issue_id, account_id, subject, archived, enqueued_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing`,
    [sendId, issueId, accountId, subject, archived, at],
  );
}
