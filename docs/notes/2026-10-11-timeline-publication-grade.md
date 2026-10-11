# 2026-10-11 — elixir_timeline is publication-grade

Feedback #373-#376 came from the daily POAP KINGS clan review (request
f126cc97, a default 24-hour read on 2026-10-11 around 10:30Z). Every
consumer was working around the same faults in its prompt: a time lead
in `text` that was wrong once posted, Friday battles showing up in a
Saturday window, the same story once per subject, the caller's nickname
in published text, a rung threshold read as a value, evidence that
disagreed with the battle count, and a war line that kept counting after
the race finished. Elixir has more than one user, so these guardrails
now live in the service output, not in each caller's prompt. MCP 11.8.0
(minor); JSON API 3.1.0 unchanged, because elixir_timeline is not an
/api/v1 operation.

## Who reads the timeline

| Consumer | Reads | Relies on | Workaround it carried |
| --- | --- | --- | --- |
| Agents over MCP (the daily clan review) | default or explicit window, no reader | `text`, `at`, `kind`, `facts`, `entries` | prompt rules: strip the time lead, ignore items older than the window, dedupe by subject, never print nicknames, distrust standout values |
| elixir-mcp-discord (POAP KINGS bot) | named `reader` per routine, `mark_read`, `skip_empty`; seed and continuation reads with no reader | `text`, `at`, `observed_at`, `kind`, `subject_tag` (local dedupe key) | "never announce the time"; a dedupe key built from kind/subject/at/text |
| Elixir's Discord and clan syndication (`packages/syndication`) | in-process `buildTimeline` from the delivery's own pointer | `text`, `at`, `kind`, `facts` | a time lead stripped by regex; its own allow-list of shareable kinds |
| Member cross-posting | `text` as posted content | `text` | none: posted as it stood |
| Console Timeline and the tracking email | in-process | `text`, `at`, `observed_at` | a time lead stripped for display |

## What changed

- **Time.** `text` is time-free. Each item carries `sort_at` (the
  newsfeed order: a sitting's last battle, else `at`), `at_unix`,
  `local` (`date`, `time`, `weekday`, `tz`) and `late`. What `at` means
  is documented per kind. Renderers build their own stamp, for example
  Discord's `<t:unix:f>`. `text_discord` was not added: a stamp is one
  field away.
- **Windows.** `basis: occurred | observed`. occurred selects by
  `sort_at` and never marks a pointer. observed is the poller's
  selection by `observed_at`, and it flags an item that happened before
  `from` as `late: true`. That is the revision of an old story, not a
  new one. The default is observed when the read names a reader, starts
  at the pointer, or passes `mark_read: true`, and occurred otherwise.
  occurred with `mark_read: true` is refused. In-process callers
  (`buildTimeline`) keep observed.
- **Identity.** Copies that share a story id merge into one item:
  the richer copy's content, the union of `subjects` (`{tag, kind,
  name}`) and the highest revision. A member's standout is the clan's
  standout. The in-game name is in `text`, and the caller's nickname
  moved to its own field.
- **Data quality.** Standouts give `crossings` (each rung's value and
  battle) and `trophy_net_peak` beside `trophy_net`, so "+1" can no
  longer read as a rung. A standout's evidence is the whole sitting, so
  `evidence.count` equals `facts.battles`. A clan entry's war decks
  tally is open only before the race finished (`warDeckTallyOpen`).
  Account events collapse into one burst item that names the apps.
- **Coverage.** Sittings carry decks (archetype labels, unclassified
  skipped), events, duration and end time. A player entry's `ranked`
  gives league, rating and rank movement, and an unmoved trophy line
  (14000 to 14000) is no longer a change. `week_resolved` lists each
  member's decks used and race points for the week.
- **Contract.** Each item carries `schema` (`<kind>/<version>`, from
  `packages/tools/src/activity/schemas.mjs`). The docs' facts table is
  held to it by a test. Each item also carries `visibility` and
  `publishable`, and both syndication paths post publishable items only.

## What stayed

Stable ids with `revision`, proved crossings with `promoted_by`, rung
thresholds, `days_quiet` beside `days_since_poll`, named readers and
`skip_empty`. Text states facts, never advice. No game data is
hand-maintained: decks, events, apps and rungs all come from the
record.

## Migration

A caller that relied on an explicit-window read moving the account
pointer names a reader or passes `mark_read: true`. Passing
`basis: "observed"` restores the old selection on any read. The
acceptance gym's timeline cases and pre-11.8.0 captured bites pin
`basis: "observed"` (`acceptance/replay.mjs`), so they replay as
recorded. elixir-mcp-discord passes `basis: "observed"` on its
reader-less seed and continuation reads, filters on `publishable`,
dedupes on `id` and `revision`, and stamps from `at_unix`, all in its
own pull request.

## Not in this change

Two items in the feedback depend on decisions, so each is filed as an
issue. Per-member war-day results and freezing a war day conflict with
"decks, not days" (weekly aggregates only). A `ranked_demotion` item
needs a new ingest path.
