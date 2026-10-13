/**
 * The mailing list caught up with the accounts (2026-10-12). The relay
 * enrolls an opted-in account with Buttondown only when it sends that
 * account a sign-in or welcome mail, so an account made for someone
 * ({account_enroll}) or one that has not signed in since opting in is
 * not on the list. {newsletter_sync} hands the relay one enroll-only
 * message per approved person who opted in; the relay enrolls each as a
 * sign-in would, leaving any address Buttondown already has (an
 * unsubscribed one included) alone, so running it again is harmless.
 *
 * Dry run by default: the count, and the email-hash prefixes of the
 * approved people it leaves off (opted out, or no address on file). No
 * address leaves the function in its answer or its log.
 */
import pg from "pg";
import { NEWSLETTER_ENROLL } from "@elixir-mcp/contracts";

export async function newsletterSync(databaseUrl, { dryRun = true, enqueue }) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select email from account
       where kind = 'person' and status = 'approved'
         and newsletter_opt_in and email is not null
       order by account_id`,
    );
    if (dryRun) {
      // Who is left off, by the account_role list's email-hash prefix,
      // so a list can be checked against them without an address.
      const { rows: skipped } = await db.query(
        `select left(email_hash, 10) as ref,
                case when email is null then 'no_address' else 'opted_out' end
                  as why
         from account
         where kind = 'person' and status = 'approved'
           and not (newsletter_opt_in and email is not null)
         order by 1`,
      );
      const refs = (why) =>
        skipped.filter((r) => r.why === why).map((r) => r.ref);
      return {
        dry_run: true,
        would_enqueue: rows.length,
        skipped: {
          opted_out: refs("opted_out"),
          no_address: refs("no_address"),
        },
      };
    }
    if (!enqueue) throw new Error("newsletter_sync needs the outbox");
    let enqueued = 0;
    for (const { email } of rows) {
      await enqueue({ kind: NEWSLETTER_ENROLL, to: email });
      enqueued += 1;
    }
    return { dry_run: false, enqueued };
  } finally {
    await db.end();
  }
}
