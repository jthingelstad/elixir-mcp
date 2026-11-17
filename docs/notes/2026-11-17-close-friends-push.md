# 2026-11-17 — Close friends' play, web push's fifth kind

Jamie, 2026-11-16: "overall the app doesn't have enough to bring people
back." Web push (`2026-11-16-web-push.md`) tells only what was done to
you. This kind tells the owner of a close mark (0281) when a friend they
starred has played: one push when a session worth telling is over, or a
headline moment. It is the only kind that names who, and it names only a
player the owner chose to star.

## What a person gets

- **One friend:** the title is the friend's game name (never a nickname,
  the bell's rule). The body is the session's fact headline from
  `@elixir-mcp/ui/session-story` ("Won 3 of 4 on Trophy Road"), and it
  opens the session page (`sessionPathOf`). A short session that was worth
  it adds its fact after a full stop ("Climbed <league> to <league>", or
  "<challenge>: up to 5 wins").
- **A headline moment** (a new best, a Ranked league up, a new Arena up;
  an Arena down is not one) is told by the timeline's own sentence and
  opens its battle (the bell's `proofOf` and `battleLinks`), else the
  player.
- **Several friends ready within five minutes of each other** are one
  notice: "Rue Tally and 2 other close friends played", the body each
  one's words ("Rue Tally: Won 5 of 5 on Trophy Road, 5 in a row. Ash
  Lark: ..."), clipped at 200, opening `/timeline?show=close`. The feed
  honours `show` for that visit only (`askedShow`, `apps/web/src/home/
  logic.js`); a tap on a notice is not kept as the reader's chip.
- **Settings › Notifications** has a fifth switch, "Close friends' play",
  "When a friend you starred finishes a session. At most three a day.",
  on. The foot now says cheers and followers are counted, and close
  friends' play names the friend you starred. The circle's offer line (no
  one starred yet) adds "With notifications on, you hear when they finish
  a session."

## Worth telling (DECISIONS: "Close friends' play is worth telling")

- A session is a run of battles with gaps under 30 minutes, the
  timeline's own boundary (`SESSION_GAP_MS`). It is told only once it is
  over: 30 minutes after its last battle, plus a five minute settle for
  coalescing (`CLOSE_SETTLE_MS`), held at most 15 minutes for a friend
  still finishing (`CLOSE_HOLD_MAX_MS`).
- Worth it: 3 battles or more (`CLOSE_MIN_BATTLES`), or a shorter session
  with a Ranked climb or a challenge run of 5 wins or more
  (`CLOSE_RUN_WINS`). One- and two-battle sessions without either, the
  ones the Timeline folds, are never told.
- Once: each notice records, per friend, the end of the last session and
  the time of the last moment it told (`push_notice.told`, 0284). A later
  session is told only if it starts after that end, so a session that
  grows (a battle learned late) is never told again. When a notice tells
  one friend, every other friend in it is recorded the same way.
- Fresh: nothing whose battle (or moment) is more than two hours old
  (`CLOSE_FRESH_MS`), by battle time, never observed time, and nothing
  from before the account's first device. A backfill of old battles is
  not activity.
- Facts only: the headline, the climb, the run. No advice, no rating.

## Caps and order

The kind is last in the drain's order: Clan Action, answers, cheers,
followers, then close friends' play. It is told only when nothing else is
told for the account in that run and no cheers are settling. It shares
the drain's gap (10 minutes) and day cap (8), and has its own ceiling of 3
a day (`CLOSE_DAILY_CAP`, counted like the other kinds by `sent_at` over
the last day). The service worker tags a notification by kind, so a new
close friends notice replaces the last one on the device.

## Privacy

The mark stays private (DECISIONS: "A close friend is a private mark",
firm). The notice goes only to the owner's devices through the existing
relay; the outbox object carries the notice's `notice_id`, `kind`,
`title`, `body` and `url` and nothing about the mark (pinned). The friend
is never told. Nothing reaches other accounts, mail, the digest, Discord,
RSS, MCP or `/api/v1`: the activity mail reads only `cheers` and
`followers` notices, and no other reader of `push_notice` exists outside
the drain, retention and account removal. A block in either direction
between the owner and the account that owns the player (its verified
claim) suppresses it. Names come from a public-record build with no
account, so no nickname (the owner's or anyone's) can enter; the service
worker's stripping path still cleans title and body. `push_notice.told`
names only players the notice's own title and body name; it goes with
the notice (28 days) and with the account. The privacy page's Notifications paragraph said every notice "says how
many, never who"; that is no longer true, so it now names the exception
and the `told` record. That is a legal page: the edit is flagged for
Jamie in the pull request.

## The candidate read

`CANDIDATES_SQL` (`services/jobs/src/push/close-friends.mjs`), once a
run, for every account at once:

1. `devices`: `push_subscription` joined to approved person accounts
   (min `created_at` is the first device).
2. `marks`: their close marks through the new partial index `claim_close
   (account_id) where close` (0284), minus any with a block either way
   against the player's verified owner (`claim_one_verified_per_tag`, then
   `blockedSql`).
3. Per distinct starred tag, a lateral over
   `battle_participant_player_time_cover (player_tag, battle_time desc)`
   for the last six hours, joined to `battle` by key for boat defenses
   and event battles; a window over that handful of rows finds the last
   session (start, end, count, any event battle).
4. Per tag, a lateral over `player_event_window (player_tag, window_end
   desc)` for headline moments in the last two hours.
5. What was told, from `push_notice_account (account_id, created_at
   desc)` for the last 12 hours of this kind.

The prefilter (`wanted`) drops, from those facts alone, every friend
still playing, every session already told or too old, and every short
session with no event battle. Only what is left is built, once per
friend per run whoever starred them, with `buildTimeline` on the public
record (the session page's own read), and only then is "worth it"
decided. No account's week is rebuilt. A short event session or a
three-battle session that is not new can be built once a minute until
it ages out at two hours; that is bounded by the friend count and is the
only repeated build.

Cost at a few thousand accounts (`close-friends-push.test.mjs`, scratch
DB): 3,000 accounts, 400 with a device, 1,500 players with 20 battles
and 20 moments each, every account following 20 and starring 3. The read
runs in about 8 ms warm (6,400 shared buffers): 1,200 starred tags, one
index range each on `battle_participant` and `player_event`, no
sequential scan of `battle_participant`, `battle`, `player_event`,
`claim` or `push_notice`. The test pins that plan shape (each record read
is an index condition naming the player).

## Mail fallback (not built)

The brief keeps this out of the activity mail and the digest. A mail
fallback would need: a section in `activity_today` for accounts with no
device, its own switch in Settings › Emails, a decision on whether a mail
may name a starred friend at all (DECISIONS' firm line says no mail
carries the mark, so this is Jamie's call), and the once-only record
moving to a per-channel `told` so a push and a mail never tell the same
session twice. Roughly the size of this change again.

## Schema and versions

Migration 0284: `close_friends` joins both kind checks
(`account_push_pref`, `push_notice`), dropped and added `NOT VALID`; a
later file owes the `VALIDATE`. `push_notice.told jsonb` (an array or
null). `claim_close` partial index. `PUSH_KINDS` in
`packages/contracts/src/queue.ts` gains the kind; `GET /api/me/push`
lists it. No IAM, secret, network or stack change. MCP 13.4.1 and JSON
API 5.1.0 unchanged.

## Who starts getting pushes when it deploys

Every approved person account with at least one push device and at
least one close mark, whose starred friend finishes a session worth
telling (or has a headline moment) in the two hours after the deploy.
The switch is on by default and nothing older than two hours is told,
so there is no backlog burst.

## Product questions, with the default taken

- **Default on?** Yes, as the brief says: turning a device on is the
  opt-in, and only accounts that starred someone are touched.
  [from the brief]
- **Three battles, five-win runs.** The thresholds are constants; the
  run's five wins is a guess at "a run worth telling". [engineering]
- **Coalescing window of five minutes**, held at most fifteen.
  [engineering]
- **A moment and a session together** tell the moment (the timeline's
  headline), and the session is recorded as told with it. [engineering]
