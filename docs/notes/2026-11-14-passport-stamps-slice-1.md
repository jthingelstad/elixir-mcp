# 2026-11-14 — Passports and Stamps, slice 1: catalog, eligibility, storage, two reads

The first build slice of `docs/plans/stamps-build.md` (#1015). Nothing
awards a Stamp yet and nothing in the app shows one: this lays the
ground the hooks, the reconciliation and the pages will stand on. No MCP
tool, `/api/v1` field, contract version, feed item or mail changes.
Migration 0269 adds four tables.

## What changed

- **`packages/stamps` (`@elixir-mcp/stamps`).**
  - `catalog.mjs` (`@elixir-mcp/stamps/catalog`) holds the eleven
    definitions with the design's stable ids, the ladders (Played
    Together 1/5/20 days, Cheerleader 3/15/50 days, Storyteller 1/5/20
    battles), the fact caps, `CATALOG_VERSION` 1 and the six profile
    steps. It is pure data and imports nothing, so the web app can take
    it without server code. A test holds it to
    `docs/design/passport/catalog.json` field for field.
  - `eligibility.mjs` takes a snapshot and an explicit `now` and
    returns earned and eligible levels, exact progress, the profile
    list and the levels to grant. It reads no database, transport or
    clock.
  - `projection.mjs` builds the public passport field by field.
  - `store.mjs` is the only reader and writer of the new tables.
- **Migration 0269.**
  - `account_passport`: one per person, with an opaque random id of
    its own.
  - `account_stamp_earned`: one row per level, with the UTC instant,
    the frozen local day, the definition version, and a legacy "earned
    before" day with its source window for the backfill.
  - `account_stamp_fact`: ladder evidence, accepted once per source,
    once per local day or battle, and capped at the top level.
  - `account_profile_list`: versioned latches for the six steps, the
    digest and map choices (`not_now` included), and a completed
    marker.

  Every table cascades on account deletion. The account-removal op
  deletes all four by name, because removal keeps a tombstone and no
  cascade fires. Retention keeps them: an earned Stamp never lapses,
  and a ladder's facts are its lifetime evidence.
- **Routes**, for signed-in people only:
  - `GET /api/me/passport` returns the owner's public projection plus
    the profile steps and exact progress. It makes the caller's own
    passport row on first read and writes nothing else.
  - `GET /api/passports/<id>` returns the public projection alone and
    never writes.

  Signed out gets 401, an agent gets 403, and no agent console reaches
  either route.

## Why it is built this way

- **Earning happens only after a real write.** Every store writer
  opens its own transaction and serializes on the account's passport
  row. The hooks will call it after their own write has committed, so
  a refused write can never earn a Stamp. A GET never grants. The
  owner may see an eligible Stamp before it is granted, and
  reconciliation will close that gap.
- **One moment counts once.** A day fact stores its local day and that
  day's UTC bounds, frozen at first acceptance. A later event inside
  those bounds counts as the same day, even after a time zone change.
  The server's own time decides "future", never a client date.
  Storyteller counts a battle once, however often its highlight is
  edited or posted again.
- **Facts hold nothing private.** A source and a battle are stored as
  sha256 digests, so the tables hold no city, coordinates, Discord
  name, highlight words or anyone else's data.
- **Unknown is not inactive.** A followed player counts as inactive
  only when their battle log was read in the last 24 hours with no
  battle in the trailing seven days. Otherwise the step is "unknown",
  and Inner Circle shows the pending count.
- **The map step reads only the profile list.** Clan's private place
  state stays Clan's. Saving a place will latch `place_saved` through
  the store, and Not now completes the step but never earns On the
  Map.
- **The public projection is a whitelist:** passport id, display name
  (the primary player's game name, or "New player"), an optional
  player (tag, name, verified, and a picture only when verified),
  earned Stamps with their day or legacy marker, and the catalog
  version. A web API test checks it for a verified account, an
  unverified claim and an account with no player.

## Not yet

The hooks, owner reconciliation (`POST`), the passport pages and the
profile list in Home, the legacy backfill, passport creation at sign
up, and any notice. See the build plan's later slices.
