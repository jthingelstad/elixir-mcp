# Passport design preview

**Design, 2026-11-14.** Storage and the two passport reads are built (`packages/stamps`, #1015); real earning and the pages are not.
Start with [product direction](../../product/stamps.md), then the
[build handoff](../../plans/stamps-build.md). The [Claude prompt](../../plans/claude-stamps-handoff.md)
starts the implementation session. Deployment is on hold.

## Try it locally

From an installed Elixir worktree, with Node 24:

```sh
node infra/scripts/build-site.mjs --skip-stats
node docs/design/passport/preview.mjs --port 8851
```

Open http://127.0.0.1:8851/. The server binds only to localhost and serves
static preview files plus existing built assets. It has no database,
live API proxy, analytics, persistence or write routes. Reload resets the
sample. Actions that demonstrate verification explicitly say preview.
Never ship this server, demo controls or artificial verification button.

Try the State selector: owner, new account, another member, unverified
member, map choice remaining, past verification without current proof,
all earned, loading and failed read. Routes in this preview are local hash
views, not implemented product URLs.

- Tap a mark for its rule, earned date, levels and owner-only progress.
- Open Home, choose email Off: All Set completes without enabling mail.
- Start Map choice remaining. Not now completes All Set without On the Map;
  a saved country or city earns both. No extra precision is required.
- Open another member's map Stamp: no location or map/settings action.
- Open the unverified member: their passport exists without a gold ring.
- Open past verification: the Stamp stays while the current gold mark is absent.
- Profile and player views show compact entry points. Bell notices open details.
- Escape closes a detail and restores focus to the mark that opened it.

## Visual direction

[Generated reference](concept.png) → [implemented phone collection](screens/owner-390-full.png).
The reference is a design aid, never UI artwork. The implementation uses
native text, CSS outlines and the installed Lucide package, with Elixir's
canonical verification glyph.

1. Preserve the approved neutral charcoal, violet actions, Clash main title
   and readable Rubik body. Section headings remain Rubik.
2. Use colored circular/rectangular ink impressions, named captions and dates.
3. Reserve gold for current identity proof and branding, never Stamp levels.
4. Keep earned/unearned states legible; I/II/III have identical ink status.
5. Keep feed space and five-item phone navigation. Passport is an account destination.

Intentional refinements from the generated concept: clean scalable line
icons instead of raster ink wear; Rubik section headings consistent with the
approved type hierarchy; two columns at 320px; country/region/city acceptance
matching the actual clan picker rather than demanding a city. The reference
prompt and source image are recorded in [concept-prompt.txt](concept-prompt.txt).

## Captures and verification

The `screens/` images are **local sample-state concepts**, not deployed
features. `?capture=1` removes only the preview controls for screenshots.
[Collection](screens/owner-390-full.png), [map detail](screens/map-detail-390.png),
[public unverified account](screens/unverified-390-full.png),
[setup](screens/home-390.png), [profile](screens/profile-390.png),
[player entry](screens/player-390.png), [bell proposal](screens/bell-390.png).

Native in-app browser inspection covered collection/details, Escape focus,
email Off, map Not now, an unverified public account, and 320/390/1280px.
Automated sample-state and accessibility results are in `screens/qa.json`.
Additional 320px checks passed at 200% text, with font requests blocked,
and with reduced motion; details still opened, closed and restored focus.
This verifies a prototype, not the future earning or privacy implementation.
