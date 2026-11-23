# 2026-11-23 — Deleting your account asks for your name

Jamie, the same day self-delete shipped (#1218): "I think you should have
to type the name of your primary player or your Elixir username to
actually delete."

## What changed

- Settings › Profile › Delete your account asks you to type your main
  player's game name or your @handle (the @ optional). An account with
  neither (no handle, and no main player or one whose name is not
  recorded yet) types DELETE, as before.
- `POST /api/me/account/delete` checks the same thing: it reads the
  account's handle and its primary claim's `player.name` and answers 400
  `confirm_required` unless `confirm` matches one of them.
- One rule for both, `deleteConfirmMatches` and `deleteConfirmWords` in
  `packages/contracts/src/account-delete.ts`: case, surrounding spaces
  and Unicode width forms (NFKC) are ignored, so a phone keyboard's
  capital or a pasted name still matches.
- The game name, not the private nickname the account may give its own
  player: the page names exactly what to type.
- Admin › Accounts is unchanged: its dry run then confirm stays.
- The panel's list no longer names agents (removed 2026-11-23).
