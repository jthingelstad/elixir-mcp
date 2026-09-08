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
{
  "as_of": "2026-09-08T12:34:56.000Z",
  "recorded_since": "2026-03-07",
  "freshness_seconds": 61,
  "completeness_note": "…",
  "events_pending": 2,
  "request_id": "4c641bc4-…",
  "contract_version": "0.31.0",
  "disclaimer": "…"
}
```

## The fields

**`as_of`** — when this answer was computed. Not when the data was captured;
when the sums were done.

**`recorded_since`** — the day capture started for the subject. This is the one
people skip and shouldn't. *"No battles in March"* means nothing if recording
began in April, and an agent that reports the first without checking the second
is confidently wrong.

**`freshness_seconds`** — the age of the freshest underlying poll. Small means
you are looking at roughly live data; large means the subject has not been
polled recently and a very recent battle may be missing.

**`completeness_note`** — present only when capture is known to be incomplete.
When it is there, say so in the answer. It is the service admitting a gap; an
agent that drops it on the floor is laundering that admission.

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
