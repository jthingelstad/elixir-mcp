/**
 * Deleting an account from the web (2026-11-23): a person's own, from
 * Settings › Profile (routes/account-remove.mjs), and any account from
 * Admin › Accounts (routes/admin.mjs). Both run the one removal,
 * `removeAccount` (@elixir-mcp/auth/account-remove), which ops'
 * `{account_remove}` runs too; this adds what only the web-api can reach:
 *
 * - The mailing list: before the address is nulled, an email-lane
 *   `newsletter_remove` for the relay to delete it at Buttondown. Handed
 *   over before the commit, so a failed hand-over leaves the account as
 *   it was and the person can try again; only when the account had an
 *   address.
 * - The sent mail's bodies under mail/sent/ in the archive bucket, after
 *   the commit, best-effort: a failure is a count in the log, never a
 *   failed request.
 *
 * The address and the keys are never logged.
 */
import { removeAccount } from "@elixir-mcp/auth/account-remove";
import { deleteSentMail } from "@elixir-mcp/mail/archive";

/** What a refusal says, to a person or to staff. */
export const REFUSAL_MESSAGES = {
  owner_account: "The owner's account can't be deleted here.",
  owns_integration:
    "This account runs an integration. Write to admin@poapkings.com to delete it.",
  collectors_live:
    "Revoke the collector first, in Settings › Collectors. Then come back here.",
  already_removed: "This account is already deleted.",
  not_a_person:
    "Only a person's account can be deleted. An agent goes with its owner.",
};

/**
 * One removal in one transaction on `db`. `guard(row)` sees the target's
 * locked row (`role`, `is_owner`) before anything is counted and may
 * return a refusal code; Admin's role hierarchy rides there, so a target
 * promoted a moment ago is read as it is now.
 *
 * Returns the removal's result (without `sent_mail`), or `{ error }`:
 * `not_found`, or `unavailable` when the mailing list's hand-over failed.
 */
export async function runRemoval(
  db,
  {
    accountId,
    dryRun,
    via,
    actorAccountId = null,
    guard = null,
    removeFromNewsletter = null,
    archive = null,
  },
) {
  await db.query("begin");
  let result;
  try {
    const { rows } = await db.query(
      `select role, is_owner, email from account where account_id = $1 for update`,
      [accountId],
    );
    if (!rows[0]) {
      await db.query("rollback");
      return { error: "not_found" };
    }
    const refused = guard?.(rows[0]) ?? null;
    if (refused) {
      await db.query("rollback");
      return { account_id: accountId, dry_run: dryRun, refused };
    }
    result = await removeAccount(db, {
      accountId,
      dryRun,
      via,
      actorAccountId,
    });
    if (dryRun || result.refused || result.error) {
      await db.query("rollback");
      return result;
    }
    if (rows[0].email && removeFromNewsletter) {
      try {
        await removeFromNewsletter(rows[0].email);
      } catch {
        await db.query("rollback");
        console.error({ event: "account_remove_newsletter_failed", via });
        return { error: "unavailable" };
      }
    }
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
  const { sent_mail: sent, ...rest } = result;
  const mail = await deleteSentMail({ store: archive, sends: sent });
  console.info({
    event: "account_removed",
    via,
    agents: rest.agents,
    mail_deleted: mail.deleted,
    mail_failed: mail.failed,
  });
  return { ...rest, mail_deleted: mail.deleted, mail_failed: mail.failed };
}
