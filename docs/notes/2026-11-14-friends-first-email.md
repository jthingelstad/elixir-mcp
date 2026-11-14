# 2026-11-14 — Friends-first email

Jamie’s quality bar is a Clash Royale player on their phone keeping up
with friends. This extends the approved visual direction into email,
which Jamie explicitly brought into scope on November 14. Deployment
remains on hold.

The digest gives each friend a full-width name and their highlights and
words, with the battle record beneath. Quiet rules separate people rather
than nesting more colored cards. This keeps the friend’s moment readable
on a narrow phone without dropping a number or link.

The common shell now uses the app’s neutral dark palette, violet primary
actions, gold brand and ownership marks, 8px corners, and more legible
system-font roles. It reaches every active product mail plus sign-in,
welcome and operator notices. The button has a background-color fallback;
tables and inline styles remain, without scripts, webfonts or SVG.

The digest captures a batch of explicit verification booleans for shown
people, the reader and alts. Clan’s action lines now carry the tag of the
person named in their title, and the mail door reads the same proof in a
batch. The existing canonical query moved from tools to auth so both
rendering paths share it without adding a package cycle. Tools re-exports
it for existing website callers. Only verified person ownership (primary
or alt) qualifies, including accounts without chosen art. Friend claims,
roles and card art do not. The email-safe gold check has an accessible
label, and the plain-text alternative says “verified player.”

No avatar, new notification, cadence or recipient policy is introduced.
Subjects, inbox previews, destinations, coverage, source words and facts
are retained. Previously sent mail stays archived as sent. MCP and JSON
API contracts, official art bytes and avatar crop values are unchanged.

## Evidence

[Before/after gallery](../design/friends-mail/README.md) includes all 27
variants at 390px and 1280px. All 27 retain the same words and links after
excluding the new verification label and allowing the digest’s record to
move beneath the highlights. Native in-app browser review covered the
digest, feedback mail and sign-in at 320px; screenshots cover the remaining
active kinds, welcome and operator notices. This is offline browser QA,
not a claim of testing every email client. No mail was sent.

Renderer tests cover explicit true, false, missing and string flags,
chosen art without proof, accessible labels and the text alternative.
Scratch-database tests cover proof without art, friend claims and a
separate verified owner, plus Clan’s real engine-to-mail path. The browser
layout checks cover all variants at 320, 390, 820, 1280 and landscape 844px
with every image blocked, including verified marks and 44px primary actions.

Node 24 `npm run verify` passed all 30 test units, static checks and Lambda
bundles. The first local browser run was stopped when the default port
resolved to a different project's long-running Python server; the complete
run uses the dedicated `ELIXIR_E2E_PORT=8843` and builds this worktree.
The isolated full browser run passed all 510 journeys without retries.
All 112 comparison PNGs and the 27-case content comparison are committed
with the gallery. No deployment or live email send was performed.
