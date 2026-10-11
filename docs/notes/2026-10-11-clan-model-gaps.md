# 2026-10-11 — The clan's model: the rewrite told the record the ledger names

No MCP or JSON API change. No migration. Follows the consistency pass
on #481 and #492.

## The Discord rewrite: moments and awards

DECISIONS ("The clan's model is told the record, never only the line")
gives both uses the member's recent moments and awards held. The Discord
rewrite's packets had neither: `clanStoryFacts` defaulted to
`moments: false`, and nothing read awards outside the drafts' ledger.

Why moments were off: the only reason on record is the `story-facts.mjs`
comment from #492, "the Discord run has the moments it is posting". No
note, commit or test names a time budget, a privacy line or an acceptance
timing. It was a judgment that the post is the moment, and it left a
member's other recent moments out of the story Jamie asked for ("pull in
the variety of data elixir has"). So they are on, kept short and bounded
for the sync's budget:

- **Moments:** the last three (`REWRITE_MOMENTS_MAX`) from the past 14
  days, for at most the first eight members a run tells
  (`REWRITE_MOMENT_MEMBERS`). Each member is one timeline read inside the
  timeline-sync Lambda (60 s; a clan run starts with 40 s left, and the
  model waits min(25 s, remaining − 8 s)), before the model's wait and
  under the row lock, so the read count is capped rather than left to
  the run's size. The items the run is posting are left out by id (an id
  names the happening, so it is the same on the clan's and the player's
  timeline). Read only while the channel's Milestones category is on:
  the leaders' switch holds for what the model may tell, too. The
  preview is told what a real post is told.
- **Awards:** the clan's `award_granted` attested facts for the member,
  this season and last (an award is granted when its season closes), at
  most six, read through `factItems` with `clanMember` (the one reader of
  attested facts and their visibility rule; `attested-readers.test.mjs`
  holds it), recorded since last season began. These are the awards the
  clan announced, the ones its members already see; the sync has no Clan
  ledger and should not, since a grant not yet announced must never
  reach an unread post. Drafts keep the ledger's grants, which a leader
  reads before anything is sent.
- `memberLines` prints awards only in `full` scope, as it already did
  moments, so a departure or a removal never carries them whoever
  gathered them.

DECISIONS now says what the rewrite gets; `/docs/clan-policy` says the
same.

## Smaller

- The chat-draft prompt said "unless the leader's note asks otherwise"
  and, through the shared writing rules, that facts may come "from the
  leader's note". Chat drafts take a tone, never a note; the rules are
  now `writing({ note })`, and the chat prompt names no note.
- The Settings model page and Social ▸ Discord listed what makes a
  rewrite keep Elixir's line without "a mention" or "runs long" (the
  engine's `mention` and `too_long`). Both now match the docs' list.
- `/docs/limits` lists Clan's model limits: 20 drafts a clan a UTC day
  (`USES_PER_DAY`, a rewrite preview included), 50 Discord rewrite
  requests a day counted apart (`ACTIVITY_USES_PER_DAY`), and the
  leader-set monthly spend cap ($0.01 to $1,000, UTC month), each with
  its refusal.

## Tests

`syndication/test/story-facts.test.mjs` (announced awards by season and
clan; moments newest first, the posted item left out, the member bound),
`clan-sync.test.mjs` (a packet's ABOUT names announced awards; a
departure's does not), `clan-engine/test/context.test.mjs` (awards out of
contribution scope), `words.test.mjs` (chat prompts name no note), and
the two page tests for the refusal lists.
