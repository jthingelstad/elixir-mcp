/**
 * Remove a person's account on their request ({account_remove: {...}}, #129).
 *
 *   {account_remove: {email: "<address>"}}        dry run: what would go
 *   {account_remove: {account_id: "<uuid>"}}      dry run, by id
 *   {account_remove: {..., dry_run: false}}       remove it
 *
 * Since 2026-11-23 a person deletes their own account in Settings and
 * staff delete one from Admin; this op stays the ops path (a request by
 * mail to admin@poapkings.com). All three run `removeAccount`
 * (@elixir-mcp/auth/account-remove), which says what goes, what stays
 * and what is refused; this wrapper only holds the connection and the
 * transaction.
 *
 * Not reachable from here, so listed in `manual`: the newsletter address
 * at Buttondown and the sent-mail bodies under mail/sent/ in the archive
 * bucket (the keys are returned; this function holds no DeleteObject),
 * both of which the web-api path does itself; call captures under
 * calls/, which expire on their own 28-day rule; and the relay's
 * timeline-discord-state/<account>/ records in the outbox bucket, which
 * expire with the bucket's 14-day rule.
 *
 * Dry run by default: `dry_run` must be false to write. One transaction.
 * The address in the payload is never returned or logged.
 */

import pg from "pg";
import { removeAccount } from "@elixir-mcp/auth/account-remove";
import { sentMailKey } from "@elixir-mcp/mail/archive";

export async function accountRemoveOp(databaseUrl, spec = {}) {
  const dryRun = spec?.dry_run !== false;
  let hash = null;
  if (spec?.email) {
    const { emailHash } = await import("@elixir-mcp/auth/crypto");
    hash = emailHash(String(spec.email));
  }
  const accountId = spec?.account_id ? String(spec.account_id) : null;
  if (!hash && !accountId) return { error: "email or account_id required" };

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    try {
      const result = await removeAccount(db, {
        hash,
        accountId,
        dryRun,
        via: "ops",
      });
      await db.query(
        dryRun || result.refused || result.error ? "rollback" : "commit",
      );
      return withManual(result, dryRun);
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await db.end();
  }
}

/** The steps outside the database, for the operator to do by hand. */
function withManual(result, dryRun) {
  if (result.error || result.refused) return result;
  const { sent_mail: sent, ...rest } = result;
  return {
    ...rest,
    manual: [
      "Remove the address from the Buttondown newsletter list by hand.",
      result.mail_archived
        ? `Delete ${result.mail_archived} sent-mail bodies from the archive bucket (mail_archive_keys).`
        : "No sent-mail bodies are archived.",
      "Call captures under calls/ expire on their own 28-day rule.",
      "Timeline cross-post records under timeline-discord-state/<account>/ in the outbox bucket expire on its 14-day rule.",
    ],
    mail_archive_keys: dryRun
      ? undefined
      : sent.map((m) => sentMailKey(m.enqueued_at, m.send_id)),
  };
}
