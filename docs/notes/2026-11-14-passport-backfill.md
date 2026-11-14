# 2026-11-14 — The passport's launch line and legacy backfill

Part of #1015 (Passports and Stamps). Migration 0272. No MCP or JSON API
contract change; the bell gains one line kind, `passport_ready`.

## The problem

Earning shipped as hooks and the owner's reconciliation. Once deployed, the
first hook or reconciliation for an account that already existed would
have granted everything it had done before as ordinary Stamps: a verified
player, a picture, a follow, months of friendlies. Each is a "New Stamp"
line in the bell, for things done long ago. The build plan wants those
marked "Earned before <launch day>" and one "Your passport is ready" line
instead, whatever runs first after the deploy.

## The launch line

- **0272** adds `passport_launch`, one row, `launched_at` written by the
  migration itself as the deploy applies it. The deploy migrates before it
  flips, so the row exists before any earning code serves. It also adds
  `account_passport.legacy_settled_at`.
- **Setup Stamps** (`packages/stamps/src/legacy.mjs`). For an account made
  before launch, the first settle (any hook, the reconciliation, or the
  backfill) evaluates the account as it stood at launch, from its rows' own
  instants: a claim made before it and verified before it (`verified_at`,
  or the claim's own instant before 0080), a picture set before it
  (`avatar_set_at`), a Discord link, a digest choice and a clan-map place
  saved before it, follows made before it with their battles in the seven
  days before it. Those levels are written as legacy rows (0269's
  `legacy_before`, the launch's local day, and `legacy_source_to`, the
  launch instant), then `legacy_settled_at` is set. The settle that
  follows grants the rest as ordinary, so a verification made after
  launch is a line even when it is the account's first earning call.
- **Ladders** (Played Together, Cheerleader, Storyteller). A level is
  legacy when the stored facts dated before launch reach its threshold;
  a level that a fact from after launch completes is ordinary.
- Accounts made after launch have nothing before it: nothing changes for
  them.
- The reconciliation's `granted` (what the client may toast) holds only
  ordinary grants.

## The bell

`services/web-api/src/bell.mjs` already left legacy rows out of "New
Stamp" lines. It now adds one `passport_ready` line per account with legacy
rows, at the first legacy row's instant, while that is within the
account-lines window (seven days). It is read from the stored rows, so it
is one line however many passes filed them. The web row
(`apps/web/src/shell/bell-logic.js`) says "Your passport is ready", with
"N Stamps you had already earned are in it." ("1 Stamp you had already
earned is in it.") and opens `/home/passport`. No email, no feed item, no
account event.

## The operator backfill

`{passport_backfill}` (`services/migrate/src/ops-passport-backfill.mjs`,
`packages/stamps/src/backfill.mjs`) walks the approved people made before
launch, by account id, in batches (200 accounts or 45 s; `limit` up to
1000, `budget_ms` up to 60000). Each account is one transaction: the
store's own transactions become savepoints inside it, so a dry run takes
exactly the apply's path and rolls back. It adds:

- the setup Stamps as they stood at launch (as above);
- Storyteller from the account's highlights with words written before
  launch;
- Played Together from recorded friendlies with a followed player in the
  year before launch, one local day once, by the live rule;
- Cheerleader from cheers given in the 28 days before launch (cheers began
  days before), each kept only when the account's own feed, rebuilt over
  those days, still holds the item and none of the players it names is
  the account's own.

Facts go through the live store (caps, one source once, one day once,
frozen day bounds). It writes legacy rows only: a level that only
after-launch evidence completes waits for the account's own next earning
call. It never removes or lowers anything, and a second run grants
nothing. The answer is counts only (Stamps by level, facts by ladder,
accounts read, granted, settled, failed) and a cursor; nothing names a
person, a player or a tag. Every run, the dry run too, takes the
production lock.

Reads are per account: the account's claims, highlights, cheers, its
follows' feed, and its own verified players' battles by their player and
time cover.

## What it cannot recover

It can only undercount:

- a cheer taken back, a highlight deleted, a follow dropped since;
- battles older than the record's year, and a cheered item the feed no
  longer builds;
- a picture or a place saved again after launch (its earlier instant is
  gone, so the Stamp is ordinary, a line, when the account next settles);
- a claim's relationship and which player is primary carry no change
  instant; they are read as they are now for claims made before launch
  (the quiet direction: at worst a Stamp is filed as legacy).

One known edge: Drop's `{avatar_import}` sets `avatar_set_at` to the time
it runs. Run after launch, it would make Looking Good one ordinary line
for those accounts.

## Commands and order

docs/OPERATIONS.md, "Passport launch backfill": deploy (0272 writes the
launch), then `npm run op -- '{"passport_backfill": {}}'` (dry run), then
`npm run op -- '{"passport_backfill": {"apply": true}}'` with each
answered `after` until `done`, never beside a deploy. The deploy alone
keeps the bell quiet; the backfill only adds history. Not run against
production in this change.
