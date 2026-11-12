# 2026-11-12 — Clan writes the app's own addresses

The Console folded (`2026-11-12-console-fold-explore.md`), and Clan still
wrote its addresses, which only redirected. This change points each at
where it now lives. No access changes: every page below keeps its own gate.

## What changed

- **A clan you are not in.** Clan's shell sent a signed-in person at
  `/clan/<tag>` for a clan that is not theirs to Explore's clan record; it
  now sends them to the clan directory searched for that clan,
  `/clan/directory?q=<tag>`. The directory reads `q` into its search box
  once. Elixir has no page for a clan you are not in.
- **The directory's tiles.** A tile for your own clan still opens Clan; a
  tile for any other clan links nowhere (it linked Explore's record).
- **A clan's link in mail and Discord** (`packages/mail` `clanUrl`,
  `packages/syndication` `clanUrl`) is the clan's own address,
  `/clan/<tag>`, so a member lands in Clan and anyone else in the
  directory. The mail's per-reader door (member to War) is unchanged.
- **One war week.** The War tab honours `/clan/<tag>/war/<season>-<n>`,
  that season's nth week counted from 1: once the week and season reads
  can place the race in a week Elixir read, it replaces the address with
  that week's page (`/war/<iso week>`); otherwise it shows the season, with
  the picker on it. Mail's race week link and Discord's week link write
  it, and `apps/web/src/lib/moved.js` sends Explore's old
  `week/<clan>~<season>~<section>` there (the section counted from 0).
- **`moved.js`:** Explore's `clan/<tag>` goes to `/clan/<tag>/feed` and
  `list/members:<tag>` to `/clan/<tag>/members` (Clan's shell sends a
  non-member on to the directory); a malformed tag still lands on the
  directory.
- **`/clan/maintain`** opens `/settings/admin/feedback` directly.

## Left alone

- Mail's Ladder links (`/ladder?player=`) still redirect, by the mail
  ruling's choice.
- `services/jobs/src/fleet.mjs` still names `/console/admin` in a staff
  alert; it redirects, and it is not Clan's.

## Pinned

`season.test.jsx` (the week's page from both reads, the address parse, a
week outside the read), `directory.test.jsx` (the search from the address,
no link for another clan), `moved.test.js`, the mail's `doors.test.mjs` and
`mail.test.mjs`, syndication's `lines.test.mjs`, and the e2e
`console.spec.ts` redirect list.

MCP and JSON API unchanged. No migration.
