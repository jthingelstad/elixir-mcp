# 2026-10-20 — One clan selection at a time

Codex on #610 (the Clan picker), on `ClanPicker.jsx`: "When a clan
selection is still awaiting `api.select()` or navigation, the switcher
remains enabled and can be reopened to start another selection. If the
two requests resolve out of order, each callback updates `me` and
navigates, so the earlier click can overwrite the later choice and leave
the user in the wrong clan." A bug fix inside the same day's feature, so
no What's new; views only: MCP 11.13.1 and JSON API 3.2.0, unchanged,
and the deploy runs no acceptance family.

- **At the source, one selection at a time.** The shell's `select` moves
  to `useSelectClan` (`packages/clan-web/src/lib/select.js`), which
  ignores a selection made while another is pending, whoever makes it:
  the picker, the chooser or the gate. `selecting` still holds until the
  address is the new clan's.
- **The picker says it is busy.** `RailSwitcher` takes `busy`: the root
  carries `aria-busy`, the head `aria-disabled` with a progress cursor,
  the list closes and the head will not open it again until the choice
  lands. The face already says "Opening …". `ClanPicker` passes
  `selecting` and ignores a choice while it holds; the Console's
  account switcher is unchanged.
- **The chooser (`/clan/clans`)** had no such race: its cards are
  disabled while `selecting`, and React draws that before a second click
  arrives. It goes through the same guarded `select` now as well.
- Pinned by `packages/clan-web/test/select.test.jsx` (two picks with the
  first `select` held: the second never starts, and the picker stays
  closed until the first lands; both fail on the old code) and a kit
  test for `busy` in `packages/ui/test/rail.test.tsx`.
