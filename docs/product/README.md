# Product briefs

One page per surface of Elixir, between [`VISION.md`](../../VISION.md)
(the root: Elixir is the missing social layer of Clash Royale) and [`DECISIONS.md`](../DECISIONS.md)
(one ruling a line). A brief says what a surface is for, who it serves,
what it never does, the principles that decide its details, and what is
still open. The details are derived from it, not asked one at a time.

**Until a brief is rewritten, `VISION.md` steers.** The briefs were
ratified on 2026-10-12, a month before the social layer; mid-build work
follows VISION and DECISIONS where a brief pulls the other way, not the
brief's default ("VISION steers until a brief is rewritten", Jamie,
2026-11-12). A brief a later ruling has overtaken carries a dated banner
at its top naming what no longer holds.

Drop is not here: it is its own product with its own rules. What Drop
consumes from Elixir is the JSON API and integrations brief.

## How a brief is written and read

- **Ratified by Jamie.** The line under the title says when Jamie read
  it and said yes. Until then every paragraph is a draft.
- **A brief is intent, never a description of behaviour.** The public
  docs (`apps/site/src/docs/`) stay the one description of what Elixir
  does today; a brief says what the surface is for and the principles
  its details follow. Where the two disagree, the public docs describe
  what runs, the brief says where it goes, and an `engineering` issue
  holds the gap; the ledger line for an unbuilt ruling names that issue
  (`open #528`).
- **Provenance, as in DECISIONS.** Jamie's own words are quoted and
  tagged `[Jamie, date]`. A paragraph an agent inferred from the record
  is tagged `[proposed]` until Jamie ratifies the page, then the tag
  comes off. A brief says no more than Jamie decided; it never widens a
  quote.
- **A ledger line names its brief.** A DECISIONS line is one sentence
  and its provenance; the reasoning behind it is here. When a line and a
  brief disagree and the brief carries no banner saying so, the
  disagreement is a question for Jamie, not a defect to fix either way.
- **Questions go through VISION and the brief.** Before building on a
  surface, a session writes a design note listing its product questions,
  each with the answer VISION implies (and the brief's, where it still
  holds). Mid-build, VISION's direction is taken, tagged
  `[engineering, date]` in the ledger, and listed in the pull request
  under "defaults taken". An in-session question to Jamie is for a
  default that would be unsafe or make the work useless if wrong.
- **Open questions stay on the page** under "Open", each with the
  default in force until it is answered.

## The briefs

| Brief | Covers |
| --- | --- |
| [The record](record.md) | what Elixir records, for whom, provenance and uncertainty, what is kept |
| [Accounts and privacy](accounts.md) | the person, their players, verification, what leaves Elixir and to whom |
| [MCP and agents](agents.md) | the tool surface and what a person's agent may do with the record (an agent is a page in Settings since step 6, see Structure) |
| [Structure](structure.md) | the record of the 2026-11-05 redesign, its twelve decisions and answers; no longer the structure record (2026-11-12) |
| [Home](home.md) | a person's day: one feed beside their week and clan, Find and You, and the first steps of a new account |
| [Console](console.md) | the account's machinery, now Settings; the Console folds into You, player pages and Settings (2026-11-12) |
| [Timeline](timeline.md) | what a story is, the newsfeed, delivery to Discord, who narrates |
| [Mail](mail.md) | the digest and the operational mails, who gets each, what it may say; rewritten 2026-11-12 for the one digest |
| [Ladder](ladder.md) | a mirror of a person's play, now Stats under You, open for the players you follow (2026-11-12) |
| [Clan](clan.md) | the clan vertical, with its sub-briefs (its arrangement to be rewritten at step 4, see Structure) |
| [JSON API and integrations](integrations.md) | the family seam, keys, what is first-party |
| [Collectors and operators](collectors.md) | bring your collector, the fleet, the one budget |
