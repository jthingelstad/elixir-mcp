# Product briefs

One page per surface of Elixir, between [`VISION.md`](../../VISION.md)
(the whole product in two paragraphs) and [`DECISIONS.md`](../DECISIONS.md)
(one ruling a line). A brief says what a surface is for, who it serves,
what it never does, the principles that decide its details, and what is
still open. The details are derived from it, not asked one at a time.

Drop is not here: it is its own product with its own rules. What Drop
consumes from Elixir is the JSON API and integrations brief.

## How a brief is written and read

- **Ratified by Jamie.** The line under the title says when Jamie read
  it and said yes. Until then every paragraph is a draft.
- **Provenance, as in DECISIONS.** Jamie's own words are quoted and
  tagged `[Jamie, date]`. A paragraph an agent inferred from the record
  is tagged `[proposed]` until Jamie ratifies the page, then the tag
  comes off. A brief says no more than Jamie decided; it never widens a
  quote.
- **A ledger line names its brief.** A DECISIONS line is one sentence
  and its provenance; the reasoning behind it is here. When a line and a
  brief disagree, the disagreement is a question for Jamie, not a
  defect to fix either way.
- **Questions go through the brief.** Before building on a surface, a
  session writes a design note listing its product questions, each with
  the answer the brief implies. Mid-build, the brief's default is taken,
  tagged `[engineering, date]` in the ledger, and listed in the pull
  request under "defaults taken". An in-session question to Jamie is for
  a default that would be unsafe or make the work useless if wrong.
- **Open questions stay on the page** under "Open", each with the
  default in force until it is answered.

## The briefs

| Brief | Covers |
| --- | --- |
| [The record](record.md) | what Elixir records, for whom, provenance and uncertainty, what is kept |
| [Accounts and privacy](accounts.md) | the person, their players, verification, what leaves Elixir and to whom |
| [MCP and agents](agents.md) | the tool surface and what a person's agent may do with the record |
| [Console](console.md) | the signed-in experience: orientation, Overview, tracking, settings |
| [Timeline](timeline.md) | what a story is, the newsfeed, delivery to Discord, who narrates |
| [Mail](mail.md) | each kind, who gets it, what it may say |
| [Ladder](ladder.md) | a mirror of a person's own play |
| [Clan](clan.md) | the clan vertical, with its sub-briefs |
| [JSON API and integrations](integrations.md) | the family seam, keys, what is first-party |
| [Collectors and operators](collectors.md) | bring your collector, the fleet, the one budget |
