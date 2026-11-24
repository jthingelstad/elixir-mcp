# 2026-11-23: A clan's policy is its Rules

Jamie (2026-11-23) on Clan's policy: "The policy section of Clan needs to
be REALLY user friendly because there is NO parallel for this in the
game... keep it simple, 5th grade words, not overly text and workable on
a mobile phone", and "this area is how a clan leader prepares their clan
to be listed in the directory... My hope is that this area allows a clan
to 'shine'."

## What changed

- **Words and paths.** What people read says Rules. The members' tab is
  **Rules** at `/clan/<tag>/rules`; Run has one item, **Rules**, at
  `/run/rules`, in place of its ten policy sections (About, Minimums,
  Clan Wars, Ranked, Donations, Trophy Road, Elder, Inactivity, Arrivals,
  Departures, Announcements). `/policy` and the old section addresses do
  not forward (an old Run section lands on Run); every producer links the
  new address: the Timeline's setup line (`home/logic.js`), Spread the
  word, Manage, Waiting, Standing (its "How it works here" and "The rule
  behind this"), Run's refusal ("Open Rules") and the Rules tab itself.
  Code, the API (`/api/clan/.../policy`), field names, analytics events
  and MCP keep "policy".
- **Six questions** (`packages/clan-engine/src/rules.mjs`, `QUESTIONS`):
  every policy field sits in exactly one, asked in the open or folded
  under **More** (a test pins the coverage).

  | Question | Asked | Under More |
  | --- | --- | --- |
  | about | war_intent, posture, goal_together | |
  | weekly | each count's switch and goal, minimums_rule, minimums_window_weeks | |
  | elder | elder_mode, the four weights (as shares), band_ceiling_share (Elder seats), tenure_min_days | band_floor_share, worthiness_percentile, promote_qualifying_weeks, swap_margin, the two demote weeks, the two renominate days, each count's window |
  | quiet | removal_enabled, watch/at_risk/confirm days, removal_includes_elders, away_max_days | away_suggestions_enabled, contribution_grace_max_days, roster_cap, renominate_removal_days, outcome_window_hours |
  | welcome | welcome_enabled, departures_enabled | |
  | sees | members_see_standing, announce_awards_enabled, announce_rules_enabled | |

- **The editor** (`apps/web/src/clan/views/RunRules.jsx`, on Run's
  `usePolicyDraft`): numbered question cards; picks, switches and steppers
  from the kit (`Switch`, `Stepper`, `SplitBar` in
  `packages/ui/src/Controls.tsx`; the split bar is SVG, so the kit's
  inline-styles count does not rise); "Was X" beside each changed answer;
  quick starts for a clan with no rules, folded under "Start over" once
  saved; the note, the preview, versions and "What these rules can do
  today" under **Before you save**.
- **The card players see.** Beside the questions on a wide screen and
  above them on a phone: the directory tile (`ClanTile`, now exported from
  `Directory.jsx`) drawn from the roster and `directoryPolicy(draft)`, the
  same public part `readClanDirectory` serves (`packages/auth` now calls
  `directoryPolicy` too, so the two cannot drift).
- **The Rules check** (`rulesCheck`, pure, in the engine): Elder seats
  full or over full, computed through `band()`, with a fix that raises
  the share to the first that makes room (`seatShareFor`); a counted
  category that has no goal and no Elder share, with a fix that turns it
  off; `validate()`'s refusals, each once, at its question, with "Go to
  question N".
- **The save bar.** Sticky at the foot: "You changed N things", the list
  on tap in the questions' own words (the Elder weights as one line of
  shares), Undo all, Save rules. Run's phone list counts the same way.
  The leave guard is unchanged.
- **The members' Rules tab** (`ClanRules.jsx`, replacing
  `ClanPolicy.jsx`): "How <clan> plays" with its lede and chips; "Each
  week, do one of these" with **You: N** from the reader's own view
  (`minimums.have`, added to `own-view.mjs`); Becoming Elder with the
  weights bar; Staying in the clan with the day line and **I'll be away**;
  What we do together; "Know someone who'd fit?" with a copy link and
  "See it in the clan list". The who-sees-what lines stay. It shows
  nobody's standing, clock or hold but the reader's own numbers.
- **Posture words.** How serious is Chill, Steady or Hardcore everywhere a
  person reads it (the field's options, the directory's chips and
  filter, whose label is now How serious). The stored values stay
  `relaxed`, `standard`, `strict`.
- **Kit.** `Stepper` steps land on the next multiple of the step and a
  typed number is kept whole and inside the range.

## Choices made without asking (reversible)

- The doc slugs `clan-policy` and `clan-policy-tabs` stay, with new
  titles, so every pointer and anchor (`#saving`, `#the-inactivity-clock`)
  keeps working.
- The card's kick day is the policy's `confirm_days`, as the directory
  serves it; the Rules tab's chip reads `removalDay()`, which adds grace.
- Quick starts stay available to a clan with saved rules, folded.
- The four count names are the goal's words (War decks, Ranked battles,
  Cards donated, Trophies), not the category names.

## Ships with

No migration, no API or MCP change, no new analytics event. Docs:
`clan-policy.md`, `clan-policy-tabs.md`, `bring-your-clan.md`,
`clan-directory.md`, `clan-settings.md`, `standing.md`; brief:
`docs/product/structure.md`.
