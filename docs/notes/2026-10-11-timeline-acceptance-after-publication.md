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

Codex's review of #472 found three more defects, all fixed here:

- **Occurred reads cut sittings.** An occurred read fetched only the
  battles played in the window, so a sitting begun before `from` lost
  its earlier games, with wrong totals, decks and evidence. The player
  path now reads the day before, as the clan path already did, and
  builds whole sittings. The window's own counts stay the window's.
- **Evidence reads lost late items.** An evidence read with no reader
  defaulted to occurred, so a poller's late item was missing and came
  back `evidence_unavailable`. A read that names no basis now looks in
  the other kind of window before answering that.
- **`member_away` dates were UTC.** `finishItem` passes the reader's
  zone to `itemText` again.

Measured live with the acceptance token: `subjects` is the heaviest
addition, at about 120 characters an item.
