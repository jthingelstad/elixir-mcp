# 2026-11-06 — The design review's ten fixes

Jamie's approval, on the critique's ranked list: "Approved to fix all 10 items."

**One frame.** `--pad-frame` is the bar's own side padding and `--content-max` is
derived from it, so Home's `.kit-shell__main`, Ladder and Settings' `.kit-frame`,
and Clan's `.page` all land on the bar's edge at every width. `apps/web/e2e/page-frame.spec.ts`
measures it. A rail takes its column inside the frame. Home's Timeline stays at
860 px inside it, because a line that long is not readable.

**Title rule.** Clan's name is in display type and pages under it step down. Clan
names are player-written; the display stack falls back per glyph to the Inter
subsets we ship, so a name the display font lacks still draws.

**Names.** The game lets a player put colour markup in a name (`<c5>`, `<\c>`, a
spaced `< c2>`). `packages/ingest/src/names.mjs` strips it from `name` fields when a
payload is admitted, leaving the raw archive as received. Migration 0234 cleans
what is stored. A name that is only markup keeps the original rather than going blank. The rule
is documented in cr-agent-api-docs.

**Pickers.** Selects share `.scope-select`: 36 px at computer width, 44 px on a phone.
What a choice is moved to an `optgroup`, so a closed select shows only the name.
`useScrollHint` in `packages/ui` marks a scrolling row so its edge can fade.

**One freshness voice.** Clan's roster footer and Season's own read pill are gone, and the
head's pill is the page's one voice. Season's pill read a different source from the head's,
so its age is no longer shown on that page: a known trade from "one source per page".
The folded chip now says what its dot means.
