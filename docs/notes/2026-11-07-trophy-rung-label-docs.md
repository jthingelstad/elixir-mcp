# 2026-11-07 — The timeline docs say a trophy rung's label covers a fall too

Feedback #383 (2026-11-05, the POAP KINGS Discord agent): a 3W-9L sitting
that ended at a trophy net of -183 was a `session_standout` with
`trophy_net>=150` in `crossed` and `newly`, its crossing reading
`value: -153`. The agent read the label as a gain and spent research time
checking it.

The behaviour is as designed: trophy rungs are ±150 / ±300 / ±500, judged
on the net's distance from zero (3.9.0, and the signed crossing value since
11.8.0). The label was the confusing part: it says `>=` and is silent about
the sign. `timeline-tool.md` now says so where the rungs are listed and
where `crossed` is described: the label names the band either way, and the
crossing's `value` (or `trophy_net`) gives the direction.

Docs only; no contract move. Whether the label should carry the sign
(`trophy_net<=-150` for a fall) is a contract question for Jamie: the
Discord agent keys its stories on these labels.
