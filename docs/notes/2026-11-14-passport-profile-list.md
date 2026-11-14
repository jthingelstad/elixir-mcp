# 2026-11-14 — Home's profile list replaces the welcome steps

Build slice 6 of [the Stamps build](../plans/stamps-build.md) (#1015):
Home's six-step profile list, from the owner's passport read
(`owner.profile`), in the place the four-step welcome had.

- **The list** (`apps/web/src/home/ProfileList.jsx`, words in
  `profile-list.js`): "Your profile, N of 6 done", one next step with
  the Stamp it earns and its way in, the six folded under a summary, and
  the extras (another player, Discord) offered and never counted. The
  next step is the first to do, else the first Elixir cannot tell yet.
  Nothing is drawn while the read loads or fails; the feed never waits.
- **The follow step never claims more than Elixir knows.** The owner's
  profile now carries `follows` (`following`, plus the active and
  unknown counts from `followActivity`), so the step says "hasn't played
  in the last 7 days" only when no follow is unknown; otherwise "Elixir
  is still catching up".
- **Map's Not now** is `POST /api/me/passport/map`; the answer replaces
  the cached read in place.
- **Reconcile on open** (`apps/web/src/lib/passport-reconcile.js`): after
  first paint, repeats while `more`, at most five calls, at most once a
  minute per tab, quiet on any failure; a pass that granted refreshes
  the bell.
- **Dismissal**: migration 0274 adds `account_profile_list.dismissed_at`;
  `POST /api/me/passport/dismiss` (20/h) sets it once, only for an
  account that finished the older welcome (`welcome_finished_at`), and
  it hides the list without completing it or granting All Set. Server
  side, as the starter set's Not now (0264), so it holds on every
  device. Others get 409 `not_offered`.
- **The welcome is gone**: the first answer's `welcome` is now `setup`
  (`following`, `digest`, read by the starter set and the digest panel),
  and it no longer stamps `welcome_finished_at`; the column stays, read
  only for `older_welcome_finished`. `welcomeSteps`, its view, tests and
  `.kit-welcome`/`.kit-check` styles are removed.

Product questions this raised, taken from the brief: the dismissal is
offered only after the older welcome (the spec's words), and an account
that never saw it keeps the list until it is done.

MCP 13.1.1 and JSON API 5.1.0 unchanged. Migration 0274.
