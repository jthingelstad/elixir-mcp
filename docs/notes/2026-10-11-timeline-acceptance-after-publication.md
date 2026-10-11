# 2026-10-11 — the timeline's acceptance after 11.8.0

The 11.8.0 deploy (#472) went live, and its acceptance run failed four
frozen Gym cases. Two were real regressions, fixed in MCP 11.8.1. Two
were intended changes, so their cases were amended.

- **321.2 (fixed).** A member read's "same id with a higher revision"
  note fired only for a `battle_session`. Since 11.8.0 a member's
  standout sitting is served once, as its `session_standout`, so the
  note went silent on exactly the sittings it was written for. The cut
  check now counts both kinds. The publication test pins it with a
  window whose only sitting is a standout.
- **254.4 (fixed).** The late note on an observed read lost the
  sentence saying the read selects by when the record OBSERVED items
  and dates each by when it HAPPENED. It says so again, beside the
  `late` count.
- **303.4 (amended).** A capped list's remainder now reads "+3 more"
  (#376), so "VVSBUDGET +3;" is "VVSBUDGET +3 more;".
- **244.1 (amended), 244.4 (added).** Items now carry their time,
  subjects, visibility and schema, about 340 characters more each. The
  frozen 51-item filtered window is therefore two pages under the
  40,000-character page budget: 36 items, then 15. #244's point holds
  across both pages. The filter applies before the cap, so the first
  page counts only filtered items and names its cut, and the
  continuation serves the rest. Both assertions still bite on the
  7.1.3 answer (18 served, 32 counted).

Measured live with the acceptance token: `subjects` is the heaviest
addition, at about 120 characters an item.
