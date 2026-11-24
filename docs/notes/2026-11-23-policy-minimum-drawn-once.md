# 2026-11-23 — A category's minimum is drawn once

Run's Clan Wars, Ranked, Donations and Trophy Road sections each showed
their minimum field twice ("Minimum war decks" above and below), so a
leader saw two inputs for one setting. `PolicySection` drew the minimum
after the section's groups, and `SectionGroups` drew it inside them too.
`SectionGroups` now skips the minimum, which keeps its place at the
section's foot beside the minimums line. A test pins one field per
section. No change to the policy, its values or what is saved.
