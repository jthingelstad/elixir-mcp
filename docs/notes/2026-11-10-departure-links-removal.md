# 2026-11-10 — A departure links the open removal it follows and preselects Kicked

Jamie, 2026-11-10: "Approved: Elixir Clan links a departure to an open
removal Action and preselects Kicked".

**The gap.** A leader who kicked a member before marking the member's
removal Action Done got two Actions that did not know each other: the
next run withdrew the removal ("They are no longer in the clan.",
`reconcileCards`), and `departuresFrom` explains a leave only by a
removal marked Done, so it raised a plain Kicked / Left / Ignore question.

**The change.** `departuresFrom` (clan-engine) now finds the removal that
was open at the leave (`openRemovalAtLeave`: raised before the leave and
still proposed, or withdrawn because the member left) and returns it with
`suggested: "kick"`. The departure's evidence carries `removal_card_id`,
`removal_number` and `suggested_classification`; its raised log, its
page, the morning email's reason and Home's Needs you say "Elixir
recommended removing them in Action #N", and the page offers **Kicked**
as the primary button. The leader still answers: nothing records a kick
on its own, per "A kick is 'was removed', never 'left'" and "people
decide".

**The removal.** A withdrawal made because the member left now carries
`withdraw_detail.left_clan` (older ones are read by their reason). Once
the departure is raised, the removal's `withdraw_detail` gains
`departure_card_id` and `departure_number` (it is withdrawn then if no run
had done it), its closed line says "Their departure is Action #M.", and
its log gets one `linked` entry. **[engineering]**

A removal marked Done still explains the leave, and a departure with no
removal before it is unchanged. Cards are JSON in the clan ledger; no
migration. MCP and JSON API unchanged.
