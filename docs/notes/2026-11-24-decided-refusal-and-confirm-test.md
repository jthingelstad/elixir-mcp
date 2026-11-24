# Decided hides its cache on a refusal; the confirm test waits for the close

2026-11-24, on #1240.

- **Decided** (`apps/web/src/clan/views/Waiting.jsx`) reads the leaders'
  record through `payload()`, so a 401 or 403 is a thrown query error. The
  Run redesign kept the last good read on any failed refetch, which left a
  signed-out or demoted reader looking at the leaders' decisions (Codex on
  #1240). A refusal now shows its own state in place of the cache; a slow or
  failed read still keeps the last good list. Pinned in
  `apps/web/test/clan/run-tabs.test.jsx`. The gated reads (`useGated`,
  `useClanMe`) were already right: they keep refusals as envelopes, and the
  view gates on them.
- **`packages/ui/test/confirm-action.test.tsx`** failed once under a full
  `npm run verify`: `ConfirmAction` reports `onDone` in the same tick as
  `setOpen(false)`, and the dialog leaves on the next commit. The test now
  waits for the dialog to go.
