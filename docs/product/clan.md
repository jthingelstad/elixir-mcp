# Clan

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

A clan is just another group of friends, and Clan is that group's piece
of the social fabric, in one view. [Jamie, 2026-11-11, `VISION.md`]
Every member sees the clan's week, its people and where they stand; its
leaders run it against its own record. A leader gets what the game
cannot give them: a policy that is actually run, award standings and the
Free Pass they would otherwise keep by hand, real activity in place of
the idle badge, Discord by webhook with no bot to run, and recruits who
match how the clan wants to play. [Jamie, 2026-11-11]

Clan never acts in the game and never decides for anyone; the leaders
do, in the game. It is for any clan: "every clan runs differently, so
Elixir Clan has no rules of its own." Nothing is judged until the clan's
leaders write its policy, and nothing clan-specific enters the code.
[Jamie, 2026-09-25, 2026-10-02]

## Who it serves

- **Every member**: the Feed (the clan's last seven days, its members'
  highlights, what waits for you and The week), Standings (Standing,
  then award races), War, Members (the roster with Follow on each row,
  Follow everyone, the clan map) and Policy (the policy in plain words
  and its weights), and their own away notice. [Jamie, 2026-11-12,
  "Clan's tabs are the canvas tabs", "Members is one page"]
- **Elders**: Recruit's pitch tools and Scout, at the roster's foot, and
  the leaders' picks that allow them. [Jamie, 2026-11-12]
- **Leaders and co-leaders**, once verified: Run, where they decide
  Actions (Waiting and Decided), review, write the policy, set holds and
  notes, set up awards and grant leaders' picks, and connect Discord and
  the clan's own model key. Anyone else is refused Run, on the page and
  on the server. [Jamie, 2026-10-12, 2026-11-12]
- **A player looking for a clan**: the clan directory (`/clan/directory`),
  searched on what only Elixir has, a clan's policy and description, for
  any signed-in person. Saving a policy is how a clan opts in. [Jamie,
  2026-11-11]
- **A person's own agent**: through the person's own connection, exactly
  what that person sees in Clan (the Actions waiting for them, their own
  standing line, the policy), never another member's clock or a removal,
  and never a decision. Any agent reads the directory. [Jamie,
  2026-10-12, 2026-11-12]

A person is in Clan as the role they hold in the game, once their player
is verified; until then they read as a member. The record learns a role
change on its next roster read, so a leader's change waits for a roster
read within the hour. [Jamie, 2026-10-12] Everyone lands on the Feed,
where what waits for each person comes first. [engineering, 2026-11-12]

## Principles that decide the details

1. **The policy is the clan's agreement, and it is versioned.** Leaders
   write what the clan counts (Clan Wars, ranked play, donations, trophy
   road), the minimums, how Elder is earned, the clocks and which Actions
   to raise. Every save is a new version; evidence saved on an Action
   keeps the version that raised it. Presets are starting points, never
   defaults that run on their own. Every member can read the policy, and
   its public part is in the directory. [Jamie, 2026-09-25, 2026-10-04,
   2026-11-11]
2. **Standing is participation, not skill.** Wins, win rates and trophies
   won are not weighed. A clan may rank its members for Elder by its own
   weights; the result is shown as groups and evidence, never as a
   score, percentile or rank. Elixir itself rates no player; a clan's
   judgment is the clan's, under its policy. [Jamie, 2026-09-19,
   2026-10-01]
3. **A change has to hold.** A promotion or demotion is raised only after
   consecutive reviews, and a declined one waits before it comes back.
   When the evidence is unknown, nothing is raised. [Jamie, 2026-10-01]
4. **Absence is stated, with what is unknown.** Inactivity is the days
   since the member's last recorded battle. At risk matches the game's
   idle warning at seven; the removal Action comes at the policy's own
   day ("10 being the absolute number"); a member at risk is asked
   whether they are away. The Action's evidence says what it rests on
   and what the record cannot see, so the leader weighs it. Clan never
   acts; the leader decides. [Jamie, 2026-10-12]
5. **Actions are atomic, human, and reach people where they are.** One
   Action is one call for one person or role: the evidence, the rule and
   policy version that raised it, the words to send. Make the change in
   the game, then mark it; Clan watches the record for the outcome. An
   Action waiting reaches its leaders in the bell, in Discord if
   connected, and in mail at most once a day; a decided one stays in Run
   for leaders only. Actions are not timeline items. A member sees their own removal clock; nobody below
   co-leader sees another member's removal or clock. [Jamie, 2026-10-03,
   2026-10-05, 2026-11-05, 2026-11-12, 2026-11-13]
6. **Messages start in chat.** Routine recognition and updates default to
   clan chat; awards, standings and rule changes offer a durable Inbox
   alternative. A receipt is a human record of what was sent, never
   inferred, never resent. [Jamie, 2026-10-05]
7. **Awards are the clan's own, decided from the record.** A clan names
   its awards; a season is judged once it is closed and whole; a computed
   decision is final; leaders' picks stay flexible, in the season running
   too. Weekly standings reach the clan as one Action; nothing posts to
   the game automatically. [Jamie, 2026-10-03, 2026-11-10]
8. **Clan drafts words; people decide.** The clan's own sealed key drafts
   messages from the record, told the clan, what happened and the member
   by name, never a tag, a note, a hold or a removal's rationale. A draft
   says at least what Elixir's own words would, then more of the member:
   "meaningfully more in-depth and personalized" (Jamie, 2026-10-20). A
   draft about one member may tell them their decks and win/loss counts,
   lifetime donations, years played, masteries and Path of Legends
   league; a demotion thanks them for older, positive history, never
   uses the recent window's numbers and never says why. In clan chat a
   draft is a few lines, each its own send. The clan has one voice, its
   leaders' words, for its drafts and its activity editor alike: given
   to the model as written, it sets the tone, never the facts, and lifts
   no rule. An Action's log keeps what the model wrote for its leaders
   and co-leaders; anyone else who reads the log sees only that a draft
   was made. Elixir Clan chooses the model for each use; the key and its
   monthly cap are the clan's. The one use nobody reviews is the activity
   channel's editor, so the engine's checks decide what it may post.
   [Jamie, 2026-10-03, 2026-10-08, 2026-10-11, 2026-10-20]
9. **Facts go back to Elixir, labelled.** What Clan attests (a kick or a
   leave as a leader classified it, awards, where the races stand) is
   written apart from the game record: award standings and awards with
   the record, other clan facts to the clan's verified members and their
   agents, an away only to its leaders. Private Clan state otherwise
   never reaches MCP or a public tool. [Jamie, 2026-09-25, 2026-10-02,
   2026-11-11]
10. **Clan posts to Discord by webhook.** Actions go to one channel as
    one message each, edited when they close. The clan's activity goes to
    a channel of its own as stories, written from the record or edited by
    the clan's model in the leaders' voice, with no time, no mention, and
    one link back to Elixir with no preview. There is no bot to run. The
    Discord agent (elixir-mcp-discord) is a separate experiment, run by a
    clan on its own tokens. [Jamie, 2026-10-10, 2026-10-11, 2026-11-11,
    2026-11-12]

## What it never does

Act in the game; decide for anyone; post to the game; show a score,
percentile or rank; show a member another's removal or clock; let an
agent decide an Action; carry a POAP KINGS default; let a model complete
or post an Action; tell a removal outside the clan. [Jamie, 2026-09-25 to
2026-11-12]

## How it fits the rest

Clan is part of Elixir: one session, one app, one web API, one Postgres,
one deploy; its code is `packages/clan*`. It reads Elixir through a
closed in-process reader with the person's own credential. A name in
Clan opens the player page, whose Clan tab is that member in the clan,
for a reader in it. A verified leader or co-leader of a followed clan
earns the Leader tier, so their clan can be recorded comprehensively,
which gives Clan fuller battle numbers and makes following clanmates
free. [Jamie, 2026-10-02, 2026-10-12, 2026-11-11, 2026-11-12]

## One clan at a time

A family (a main and its feeders) is a recording concept of the Family
tier. Clan sees one clan at a time: each has its own policy, standing,
Actions and awards, and a leader switches between them. [Jamie,
2026-10-12]

## Open

- **Acting from Discord** stays undecided on purpose. [Jamie, 2026-10-12]
- **The clan map and young players**: the map shows a place only to the
  clan's verified members while its leaders keep it on; a player map
  waits on a legal view.
