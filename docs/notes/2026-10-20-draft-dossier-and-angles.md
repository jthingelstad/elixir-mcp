# 2026-10-20 — Draft in our voice: the member's dossier and story angles

Stage 2 of the "Draft in our voice" redesign. Jamie, 2026-10-20: "in Clan
when we use the LLM token that the clan has provided and do "Draft in our
voice" for a leader action the intent is that it should use the full data
resources of Elixir to create a meaningfully more in-depth and
personalized message. Right now, it seems to do the opposite and actually
make the message even less useful." Jamie approved the redesign with
product calls 2 and 3 as recommended:

- **Call 2.** Members may see new kinds of fact in a drafted message:
  decks and win/loss counts, lifetime donations, years played, masteries
  and Path of Legends league. The never-send list is unchanged.
- **Call 3.** A demotion thanks the member for older, positive history
  and never uses the recent window's numbers.

No contract change: MCP 11.13.1 and JSON API 3.2.0. No migration. The
deploy runs no acceptance family: no tool's declaration or output changed.

## What changed

- **The dossier** (`packages/syndication/src/story-facts.mjs`). A draft
  about one member asks `draftStory` (the web API's `storyFor`) for that
  member, and the story gains `dossier`, read one query at a time from
  existing readers:
  - war: every finished war week of the clan's last 52, joined to the
    member's participation (decks used, points; never fame);
  - donations: the last 12 whole weeks in this clan from
    `record/member-activity`, and the career total from the recorded
    profile;
  - profile highlights from `record/recorded-profile`: years playing,
    favourite card, cards at the top Mastery level, legendary badges
    (level-less, not dated seasonal ones), best Path of Legends league
    (the league number, no name), Clan War Wins badge;
  - decks over 28 days: Trophy Road, Path of Legends and this clan's war,
    each mode on its own (`modeGroupSql`), from `battle_time`, boat
    defense excluded, a duel counted as its rounds
    (`participantGamesSql`); the top two decks with at least three games
    per mode, named by archetype label only, an unclassified deck not
    named;
  - milestones over 28 days from the timeline builder, newest first, up
    to 8; role changes here, newest first, up to 6; awards held.

  The member block's own war weeks and moments are left empty for the
  dossier's subject, so each is told once. Without one member the story
  is unchanged (the Discord editor never asks for a dossier).
- **Lines and angles** (`packages/clan-engine/src/context.mjs`).
  `dossierLines(dossier, kind)` writes the MEMBER DOSSIER block:
  played weeks only (12 listed, earlier ones summed by season), the
  totals, the best week and the longest run in a row, weekly donations
  with their total and best, and the profile, decks, milestones and
  roles. `storyAngles(dossier, kind)` scores candidate sentences per kind
  and keeps four, strongest first; each number in one is in the lines
  told. `dossierBlock` joins both after the member block in
  `packages/clan/src/manage/drafts.mjs`.
  - Demotion: only weeks and donations older than the policy's recent
    weeks (`recentWeeksFor`: the longest of its war, ranked, donation and
    minimum windows plus its demotion weeks, less one, held to 4-16), and
    no profile, decks, milestones, career or roles. Never a zero, a gap
    or a time since.
  - Removal and departure: the war weeks played, nothing else.

## Size and time

The dossier sits in the packet (the user turn, uncached), since it is per
member; the cached prefix is the clan block, already over 512 tokens. By
a characters-over-3.6 estimate, a full promotion or welcome dossier with
its angles is about 1,360 tokens at most, a demotion's about 530 and a
removal's about 470, so a packet stays under about 1,700 tokens. On a
seeded scratch database (7,800 battle participants, 18,300 profile
snapshots) the draft's story took a median of 9 ms with the dossier
against 3 ms without.

## Defaults taken [engineering]

The windows (52 war weeks, 12 donation weeks, 28 days for decks and
milestones), the counts (2 decks a mode, 3 games to be named, 10 for an
angle, 8 milestones, 6 role changes, 8 masteries named, 6 badges), the
three modes, the angle scores and the demotion's recent window. Reads run
one at a time on the one client (`docs/ENGINEERING.md`).
