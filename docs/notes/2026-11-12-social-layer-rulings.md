# 2026-11-12 — Jamie's social-layer rulings, recorded

Jamie ruled on the inventory of Elixir against `VISION.md` on 2026-11-12.
This change records those rulings in `docs/DECISIONS.md`, the root
`AGENTS.md` and `docs/product/`. It changes docs only: no behaviour, no
contract version, no migration, and no What's new entry. The build work
the rulings call for lands in its own pull requests.

## Lines added

- **Scope:** "The public story opens with the social layer"; "The POAP
  KINGS seed succeeds at 15 and 10" (15 or more accounts sign in during
  both weeks, and 10 or more of them cheer, follow or highlight; per
  account, never per mail recipient). "What we never do" now says these
  counts are not engagement scoring.
- **MCP:** "Follow, never track" (tool names and the `recordings:write`
  scope included); "Agents read the social layer and never write it"
  (the renames as series, the two folds and the two retirements, in an
  MCP major Jamie approved).
- **Clan:** "Clan's Actions are notifications and timeline items".
- **Web:** "Console folds into You, player pages and Settings"; "The feed
  shows only people's play"; "Stats opens for the players you follow";
  "The welcome checklist finishes for good".
- **Email:** "The digest is the one scheduled mail; leaders' Actions mail
  stays apart". Jamie named the clan report; Arena week and the milestone
  mail stopping too is the agent's reading of "one digest email" and is
  tagged `[engineering]`.
- **Process:** "VISION steers until a brief is rewritten"; "Approval-era
  and retired code goes".

## Lines replaced or removed

- "The redesign's structure is `docs/product/structure.md`" became
  "`VISION.md` steers Elixir's structure; `docs/product/structure.md` is
  the 2026-11-05 record".
- "Explore is a power-user corner", "Seven product kinds", "Members is
  one page; nobody's access changed", "`clans_context` is an agent's one
  bounded exception" and "Product briefs sit between VISION and this
  ledger" are replaced by the lines above, each naming what it replaces.
- "Milestone mail is the big firsts", "Alts' firsts wait for Tuesday" and
  "The beta pulse is aggregate by signup week" are removed.
- Amended in place: "Agent-only tools", the Discord activity channel (no
  link preview), "Whether the timeline is stored" (the 2 s p95 bar),
  "Reactions, not comments" and "Nothing runs until a clan has a policy"
  (agents read cheers and the directory), "The bell is what is about you"
  (A4 retired), "One a day is for scheduled mail only", "Ultimate
  Champions and Card of the Week are retired" (the tombstones go), "A
  linked Discord tells an agent who is asking" (the major that removes
  `elixir_identify`), "A name in Clan opens the player page".
- Wording only, no rule changed: lines that named the Console, Ladder or
  the beta now say the app, Settings or Stats.

## Briefs

The root `AGENTS.md` and `docs/product/README.md` say VISION steers until
a brief is rewritten. Structure, Console, Mail, Ladder, Clan, Timeline,
Home, MCP and agents, and Collectors carry a dated banner naming what no
longer holds. The briefs themselves are not rewritten here.

## Left for Jamie

- The collector mail was not named in the mail ruling; its lines stand.
- Which of the clan report's own lines carry into the digest's clan week
  is for the change that merges it to propose.
