# Timeline items say where they lead (11.9.0)

Jamie, 2026-10-11: the timeline is chatty by design and is the unique
piece; it "should then pull together other parts of our data and mcp for
further info". Approved: "add follow (tool + args read-addresses) to
elixir_timeline items as a minor after 11.8.0".

## What shipped

- `packages/tools/src/activity/follow.mjs`: `followFor(item, window)`
  maps a finished item to `[{ tool, args }]` from the item alone (facts,
  subjects, id, and the window and basis that served it). `forCaller`
  drops tools hidden from the caller's principal kind
  (`toolsHiddenFrom`). Today no address is hidden from a principal that
  can read the timeline; the filter keeps it that way if one is.
- The handler attaches `follow` on full verbosity before the page budget
  runs, so the size cut counts it. Compact leaves it out.
- A sitting's first address is its own evidence read; its `from` and `to`
  are the serving window, so it reads back exactly that item.

## Why addresses, not answers

Embedding the expanded data would make the chatty feed heavy and
duplicate other tools' derivations. An address costs about 100 to 250
characters per item, says nothing about what to conclude, and keeps each
fact in the one tool that owns it.

## Tests

- `test/timeline-follow.test.mjs`: a synthetic item of every kind in
  `TIMELINE_KIND_SCHEMAS`; every address is a registered tool and its
  arguments pass that tool's input schema, required arguments included;
  every non-account game story leads somewhere.
- `test/timeline-publication.test.mjs`: a sitting's evidence address,
  called through the handler, returns that item and its games; compact
  carries no `follow`.

## Codex on #476 (11.9.1)

- P1, real: battle tools select `[from, to)`, so a sitting's span read to
  `ended_at` left its last battle out (a one-battle sitting read zero).
  The span is now `[started_at, ended_at + 1 s)`; the handler test calls
  it and holds its battles and wins to the sitting's.
- P2, real: a player's own `clan_joined` / `clan_left` can name a clan
  nobody records, and `clans_roster` answers `not_recorded` there. Those
  moves lead to the member only; a clan feed's moves keep the roster.
