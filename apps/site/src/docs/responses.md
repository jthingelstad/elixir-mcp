---
slug: responses
title: "Reading a response"
navTitle: "Reading a response"
description: "Every Elixir MCP response carries a meta envelope: when it was computed, how far back the record goes, how fresh it is, whether capture was incomplete, and the id of the call that produced it."
order: 31
section: reference
---

# Reading a response

Every tool response carries a `meta` envelope. It is small, it is always there,
and it exists because *"is your data right?"* is the question people actually
have about a service like this.

```json
{{ responses.example | json | safe }}
```

Timestamps in the envelope are ISO 8601 UTC strings. History fields are omitted
when unknown; a source poll that has never happened uses explicit nulls for
both its timestamp and age. The server checks these shapes against the shared
contract before returning a tool result.

## The fields

**`as_of`** — when this answer was computed. Not when the data was captured;
when the sums were done.

**`recorded_since`** — the earliest stored history among the player sources
used by this answer. Battle history can predate profile snapshots or signup.
This is not a promise of continuous capture; check `elixir_coverage` before
interpreting an empty period. On mixed profile/battle answers, the sources can
have different start dates.

**`recording_active_since`** — when the currently active recording began. Kept
separate because imported history and earlier opponent appearances can predate
it. Stopping recording does not erase the stored history.

**`source_polls`** — each relevant endpoint's `observed_at` and
`freshness_seconds`. Battle tools use the battle-log poll, profile tools use the
profile poll, and the player summary exposes both. `war_current` exposes its
current-race poll. A source never polled reports null values.

**`freshness_seconds`** — the oldest of those relevant poll ages, not the newest
poll of any kind. It is null if a required source has never been polled. A fresh
profile must never disguise a stale battle log. These fields describe polling
freshness, not the age of every individual historic row.

**`completeness_note`** — present only when capture is known to be incomplete.
When it is there, say so in the answer. It is the service admitting a gap; an
agent that drops it on the floor is laundering that admission.

**`timezone_applied`** — the display timezone used for local labels, when one
was requested or configured. Stored timestamps and the envelope remain UTC.

**`feedback_responses_pending`** — maintainer replies waiting to be read with
`elixir_my_feedback`.

**`events_pending`** — unread items in your event feed. A hint to call
`elixir_events` rather than re-polling the data tools.

**`request_id`** — the id of the call that produced this response. Quote it when
reporting an answer that looks wrong and we can find the exact row. Your own
call history, with these ids, is on **Account → Activity**.

**`contract_version`** — the tool contract this response was produced under. If
it differs from what you cached, re-read `tools/list`; `elixir_changelog(since)`
says what moved.

## Honesty is a design position

The service records history from a game API that only answers *"what is true
right now"*. That means gaps are structural, not exceptional: a clan added last
week has no history from last year, and a subject that stopped being polled has
a stale tail.

The envelope exists so an answer can be *honest about its own limits* without
the agent having to guess at them. Three habits worth building into any client:

1. **Caveat against `recorded_since`** before making a claim about a period.
2. **Repeat `completeness_note`** rather than summarising past it.
3. **Never present a recalled figure as recorded data.** If the tools cannot
   answer, say so — `elixir_coverage` will tell you how complete a record is.

## Coverage and result limits

`elixir_coverage.observation_intervals` compares a profile's lifetime-battle
counter change with battles recorded in exactly `(observed_from, observed_to]`.
Intervals can span several days and are recalculated when read, so late-arriving
battles improve the estimate. A missing observation time or incompatible counter
cannot produce a reliable estimate. These are estimates of capture, not proof
that every battle is present.

`completeness_last_7_days` covers intervals **ending** in the last seven days;
one can begin earlier. `average_ratio` is weighted by expected battles and
excludes intervals whose ratio is unknown. `measured_intervals` and
`unknown_intervals` make that distinction visible. `incomplete_intervals` counts
measured intervals with fewer captured than expected battles. Interval
`is_complete` uses exact counts even when a rounded ratio displays as one. The old `incomplete_days` field is retained as
null: a multi-day interval cannot establish which particular day lost battles.
The tail since the latest profile and older unbracketed history remain unknown.

Performance summaries aggregate the full requested time window. An explicit
`last_n_battles` selects a recent sample; ordinary date windows have no hidden
2,000-battle ceiling.

`war_current.period.source_observed_at` is the latest successful current-race
poll, while `started_observed_at` is the first sighting of that period.
`nominal_period_elapsed` signals that the observed period's policy window has
ended. This does not assert the next period was captured: use `game_clock` for
the policy clock and the source observation for what the recorder knows.

An MCP result exceeding the delivery limit is a structured `bad_request` error,
not a cut-off JSON success. It retains its request ID and suggests narrower
arguments where available. No partial result should be interpreted as complete.

## Errors

A failed call returns a structured body rather than prose:

```json
{ "error": { "code": "not_found", "message": "…", "hint": "…" } }
```

The `code` is from a closed set, so a client can branch on it; the `hint` says
what would fix it. Errors carry a `meta` envelope too, with the same
`request_id` — a call that failed is still a call you can ask us about.

**A note for client authors:** check the error body, not just the transport
flag. A call can fail without a protocol-level error flag being set, and a
client that only checks the flag will report confident success on a refused
call. That has happened here, to us.
