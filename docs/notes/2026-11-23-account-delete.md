# 2026-11-23 — Deleting an account from Settings and Admin

**What.** A person deletes their own account in Settings › Profile ›
Delete your account (`POST /api/me/account/delete`, session and contract
header, body `{confirm: "DELETE"}`), and staff delete any account from
Admin › Accounts (`POST /api/admin/accounts/remove`, a dry run unless
`dry_run: false`). ops' `{account_remove}` stays for a request by mail.
All three run one removal, `removeAccount` in
`packages/auth/src/account-remove.mjs`; the migrate op is now a thin
wrapper around it.

**The census.** `packages/auth/test/account-remove-census.test.mjs`
reads the migrated schema and fails on any table that names an account
(a foreign key to it, or a uuid column ending `account_id`/`account`)
that is neither in the removal's steps nor on `KEPT_TABLES` with its
reason, and on any `account` column neither cleared by the tombstone nor
listed as kept. The hand census had stopped at 0285; it found
`comment_conversation` and `comment_conversation_read` (0303) and
`timeline_clan_reader` (0308), now removed. Kept on purpose: `account`
(the tombstone), `recording` (who requested it, provenance on the
record), `attested_fact` (the clan's fact), `gateway` (revoked
collectors' history) and `integration` (staff retire it before its
owner goes). The tombstone also clears the columns added since:
`test_name` (0316's check needs it null once the hash is no longer
`test:`), `age_attested_at`, `welcome_finished_at`, `starter_hidden_at`,
`own_refresh_at`, and resets `auto_follow_clan` and the stored role. A
person's place (`place#<tag>` in `clan_state`, stamped with the account,
0276) is deleted with the account; it is keyed by tag, so no census can
see it.

**Outside the database.** The web paths do what ops listed as manual:

- Before the commit, the web-api enqueues an email-lane
  `newsletter_remove` (`NEWSLETTER_REMOVE` in `packages/contracts`) when
  the account had an address. A failed hand-over rolls back and answers
  503, so nothing is half done. The relay deletes the subscriber at
  Buttondown; a 404 is success, nothing retries, and it logs
  `newsletter_removed` or `newsletter_remove_drop` without the address.
- After the commit, the sent mail's bodies under `mail/sent/` are
  deleted, best-effort (counts in the log only). `WebApiRole` gains
  `s3:DeleteObject` on `mail/sent/*` alone, pinned by
  `services/mcp/test/infra-controls.test.mjs`; the bucket is versioned
  and `mail-sent-purge-expired` takes the noncurrent body a day later.

`{account_remove}` still returns `manual` and `mail_archive_keys`.

**Who may.** A refusal is a 409 with a `code` and a message: the owner's
account, an integration's owner, a live collector, an account already
removed. Admin also refuses removing yourself (`self`, use Settings) and
answers 403 `above_grant` when an admin targets another admin: only the
owner removes an admin. The guard reads the target's locked row. The
`account_removed` event records `via` (`ops`, `self`, `admin`) and, for
Admin, `by`.

**Admin's list** adds `test_name`, `removed` and `last_active_at` (the
latest session seen or key used). Tombstones hide behind "Show N
removed", test identities read "Test: <name>", and the record page's
Delete account warns on the acceptance and gym identities.

Ships with no migration, no MCP change and no `/api/v1` change. The
deploy carries the IAM statement.
