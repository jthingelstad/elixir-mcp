# 2026-11-13 — Design pass two: the digest choice and directory tiles

Second design pass, part 2. Layout only where the data already exists;
no read, endpoint or setting was added.

- **Settings › Emails** (`apps/web/src/views/account/EmailPage.jsx`):
  the digest row is one Weekly / Daily / Off segmented control in place
  of its switch plus a cadence picker. It writes through the existing
  `api.setDigest` (Off is `enabled: false`; Weekly or Daily is the
  cadence with `enabled: true`), the same preference and endpoint the
  switch used. The other kinds keep their switches. `setDigestCadence`
  in `apps/web/src/api.js` had no other caller and went.
- **Clan directory** (`packages/clan-web/src/views/Directory.jsx`):
  each tile ends with a footer, pinned to the tile's bottom so footers
  line up across a row: members and the removal day (the same words as
  before), and "Your clan" in place of the old chip.

Not done:

- The clan header's Follow / Following: it needs a per-clan follow read
  on the clan page; Home's follow plan is the only reader.
- The sign-up step indicator: the real sign-up is two steps (email, then
  the code), so a five-step indicator would describe steps that do not
  exist.
- Wording that promises who sees something (the canvas's visibility
  pills) was left for Jamie.
