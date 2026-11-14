# Claude handoff: build Elixir passports and Stamps

Paste the following into a new Claude session in the Clash Royale workspace.

---

Build Elixir's Passport and Stamps from the completed design handoff
(implementation issue #1015).
Read the domain AGENTS.md/WORKFLOW.md and elixir-mcp/AGENTS.md. Use a fresh
session worktree and branch, with a draft PR on first push. **Do not deploy,
run a live backfill, send email, or manufacture production social activity.**

Read in this order:

1. elixir-mcp/VISION.md and docs/product/stamps.md.
2. docs/design/passport/README.md and its concept, screenshots, catalog and
   local interactive preview.
3. docs/plans/stamps-build.md, including source seams, storage, identity,
   write hooks, bounded reconciliation, backfill and acceptance matrix.
4. docs/design/experience-review/README.md and existing Bell issue #1009.

Accepted product decisions from Jamie:

- The metaphor is an ink stamp in a passport. Call them Stamps; Clash Royale
  has Badges. Avoid medals, rarity, points, streaks and reward chests.
- Earned Stamps are visible on every person account, including new and
  unverified accounts. No hide switch or verification-only Passport gate.
  Use the existing signed-in-member boundary; no new anonymous access.
- Successful player ownership verification earns Player verified. Saving
  a place on the clan map earns On the Map. Country/region/city all count
  under the existing map permissions. Never reveal location in a Passport.
- Gold ring/check is CURRENT ownership proof everywhere an avatar/name
  appears. A dated verification Stamp is historical and never supplies gold
  after proof is revoked. Use the canonical shared Avatar/PlayerName/glyph, including the existing
  plain Main player name in Profile highlighted by the experience review.
- Phone first: fast, fluid and fun for a Clash Royale player keeping up
  with friends. Preserve Clash main headings and Rubik interface type.
- Keep changes consistent with email templates. Stamps themselves add no
  feed items, digest rows, achievement email or forced email opt-in.

The eleven-Stamp catalog and level thresholds are engineering proposals
based on the older nine-Stamp plan plus Jamie's verification/map milestones.
Implement the defined conservative rules; document material tradeoffs.
The older domain plan's verification-only/optional visibility and exclusion
of verification/location rewards are superseded by this newer direction.

Important implementation constraints:

- Person accounts need their own opaque Passport ID. account.public_id is
  currently agents-only; do not repurpose it or expose internal UUID/email.
- An unverified account has its direct Passport, but never attach an
  arbitrary unverified claimant as owner of the canonical game player page.
- Owner-only exact progress; public projection only identity plus earned
  Stamp IDs, highest level and earned date. No private account fields.
- Six compact profile steps: add primary, verify primary, choose picture,
  follow one active player, explicitly choose weekly/daily/Off email, and
  set map place or Not now. Off and Not now count for All Set; Not now
  does not grant On the Map. Alts/Discord are optional.
- Earn only after successful existing writes; use idempotent bounded owner
  reconciliation for recorded game facts. Public GETs never grant awards.
  No new CR calls or scheduled job. Preserve lifetime distinct-day/battle
  progress across retention, retries, concurrency and timezone changes.
- Read the backfill section before choosing earned dates. Provide aggregate
  dry run; report lower bounds where history is gone. No historic Bell flood.
- Reuse native UI, existing Lucide and exact official game art/crops. The
  local prototype is a design reference, not production code or earning
  logic. Do not ship demo controls or artificial verification actions.

Build in the handoff's slices, testing privacy, deduplication and real
mutation success/failure before integration. Verify 320/390/1280px, enlarged
text, font/art failure, reduced motion, touch targets, sheet Escape/focus,
loading/error and unverified/public states. Use native browser tools as
well as Playwright. Run Node 24 npm run verify before each push and the
required e2e gate. Read PR summary and inline reviews before session-finish.

Keep unrelated phone review recommendations for discussion; the real Bell
read/seen redesign is separate from adding a Stamp destination. Land via
normal reviewed PRs and finish the session. Report what is built versus
still proposed. **Do not deploy until Jamie explicitly lifts the hold.**
