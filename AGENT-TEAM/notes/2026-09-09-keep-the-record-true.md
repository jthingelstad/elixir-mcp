# Keep the Record True — 2026-09-09 late run

Preflight was clean and synchronized; the record checkout was leased only for
this run's note. The public health snapshot was healthy (`ok=true`, most
recent admission 270 seconds old, 193 battles in the prior hour, DLQ 0).

## Capture and scheduler evidence

The private read-only `{capture_audit:{days:1}}` census returned 805 eligible
battlelog polls and 21 possible rotating-window gaps. Gaps remain concentrated:
two subjects had two each and the other 17 subjects had one each; every listed
subject had a later planned and admitted poll. This is a measured capture-loss
signal, not a queue stall or a first-poll artifact.

The loss-bound `half` experiment is too young to promote or change. Comparing
the eight hours before the 14:41Z deployment with its first eight hours:

| Arm | Pre-flip gaps / audited | First post-flip gaps / audited |
| --- | ---: | ---: |
| treated | 1 / 101 (0.99%) | 2 / 193 (1.04%) |
| control | 4 / 97 (4.12%) | 3 / 147 (2.04%) |

The arms had different baseline grinder mixes, and the ratified criterion is
the treated arm below one third of its own pre-flip rate over 72 hours while
control does not improve the same way, with total fetches below 200/hour.
Neither condition is established after eight hours. The scheduler is therefore
unchanged; the next record run should repeat the same difference-in-differences
reader once the 72-hour window closes.

`{probe:true}` showed ordinary post-flip hours at 103-153 total fetches/hour
(with the current partial hour at 65), below the 200/hour guardrail. The corpus
has 57,650 battles, 4,453 daily snapshots, 170 war weeks and 65 war anchors.

## Projection, clock, and live API spot checks

The seven-day projection census has populated war keys for current season 135
war days 1-4, and training-period rows correctly carry a null `war_day`.
It also reports older/cross-section river-race rows without a stamp; that is
the documented honest-null behavior of `resolveWarKeys`, not enough evidence
to restate history. The war-anchor reader reports 65 anchors across 10 clans,
median observed offset +4 minutes; the reader explicitly includes polling
latency, so it remains an upper bound rather than a calendar correction.

Direct, read-only Clash Royale API checks matched the documented model: King
Thing (`#20JJJ2CCRU`) reported battleCount 1,915, a 30-entry battle log with
ISO-Z battle times, 1-16 card levels, and distinct `evolutionLevel` fields;
POAP KINGS currentriverrace was `training`, period index 0, with all five
boats at zero fame/repair points. No new field, enum, card form, or points-vs-
fame contradiction was observed, so `cr-agent-api-docs` needs no patch.
