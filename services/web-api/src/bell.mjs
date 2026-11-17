/**
 * The bell (2026-11-12): what is about you, not your friends. Jamie's go,
 * 2026-11-12: "Approved: build the remaining canvas pieces (bell, …)", the
 * design canvas's bell: reactions to your items, new followers, actions
 * waiting (leaders) and answers to your feedback. Actions waiting are Clan's
 * own read (`/api/me/home/needs`); this module is the other three and the
 * account's seen marker (`bell_seen`, 0244).
 *
 * Who sees what, and no more:
 *  - Reactions: cheers by other people on the items about your own verified
 *    players, as counts per cheer. Never who cheered (DECISIONS "Reactions,
 *    not comments": counts only, never who).
 *  - Followers: people who follow one of your own verified players, named
 *    only as DECISIONS "What is public about an account" names them on that
 *    player's page (their account's verified player, by game name and tag);
 *    an account with none is counted, never named. No follow time is shown.
 *  - Answers: your own feedback's answers, which you already read in
 *    Settings › Feedback.
 *
 *  - Your account: the account's own administration of the last seven days
 *    (players and clans added, recording started or stopped, a player no
 *    longer yours, connections and the like), out of Home's feed since
 *    2026-11-12. A burst is one line per kind ("Recording started for 24
 *    players"). Sign-ins stay in Settings › Sign-ins & devices; answers are
 *    their own section.
 *  - A new Stamp (#1015): one line in Your account for each Stamp a pass
 *    granted, at the highest level that pass granted, linking to the
 *    passport's sheet for it. Read from the earned rows themselves
 *    (account_stamp_earned), never from account_event, so a Stamp never
 *    reaches the MCP timeline, Settings' log, the funnel, mail or the
 *    digest; a backfilled (legacy) level is never a notice.
 *
 * Reactions, followers and answers are read through
 * @elixir-mcp/tools/activity/bell, which the activity mail and push read too
 * (2026-11-16, docs/notes/2026-11-16-reach-you.md); nothing here goes to
 * Discord, MCP or `/api/v1`, and an agent has no bell. Reads are bounded:
 * your own players' last seven days (the window a cheer can be given in) come from their stored week (bell_week, 0247;
 * readBellWeek), built on the read only when there is none, your players
 * changed or it is past three hours, and four small queries. Highlights,
 * attested facts and cheers are read live. Clan's waiting Actions are not
 * here: Home's needs read asks Clan on every request.
 */
import {
  BELL_LIST_CAP as LIST_CAP,
  bellSeenAt as seenAt,
  ownVerifiedPlayers,
  readAnswers,
  readFollowers,
  readReactions,
} from "@elixir-mcp/tools/activity/bell";
import { levelCount, stampById } from "@elixir-mcp/stamps/catalog";

export { markBellSeen } from "@elixir-mcp/tools/activity/bell";

/** Your account's lines look back as far as Home's feed did. */
const ACCOUNT_DAYS = 7;
/** Events of one kind this close together are one burst, one line, however
 *  other kinds interleave (adding a player logs "claim added" and then
 *  "recording started", so a run of follows alternates the two). */
const ACCOUNT_BURST_MS = 10 * 60_000;
/** How many of an account's events one read folds: a burst past this is
 *  still one line, counted from what was read. */
const ACCOUNT_READ_CAP = 500;
/** Kinds the bell does not tell: sign-ins are in Settings › Sign-ins &
 *  devices, and answers to feedback are their own section. */
const NOT_ACCOUNT_LINES = ["signed_in", "feedback_responded"];
/** How many reads of the bell one person may make in an hour: the dot reads
 *  it every few minutes, and opening the sheet reads it again. */
export const BELL_READS_PER_HOUR = 120;

/** Your account's own lines, each burst of one kind folded into one: what
 *  it is, how many players and clans it names (a few by name, for a line
 *  about one), when it last moved, and whether that was since you last
 *  opened the bell. Names are the game's, never a nickname. */
async function readAccountLines(db, accountId, seen) {
  const { rows } = await db.query(
    `select e.kind, e.created_at,
            e.detail->>'player_tag' as player_tag,
            e.detail->>'clan_tag' as clan_tag,
            coalesce(p.name, c.name) as name
       from account_event e
       left join player p on p.player_tag = e.detail->>'player_tag'
       left join clan c
         on e.detail->>'player_tag' is null
        and c.clan_tag = e.detail->>'clan_tag'
      where e.account_id = $1
        and e.created_at > now() - make_interval(days => $2)
        and e.kind <> all($3::text[])
      order by e.created_at desc, e.event_id desc
      limit $4`,
    [accountId, ACCOUNT_DAYS, NOT_ACCOUNT_LINES, ACCOUNT_READ_CAP],
  );
  return foldAccountLines(rows, seen);
}

/** Rows newest first → lines newest first. Pure, for the tests. */
export function foldAccountLines(rows, seen) {
  const seenMs = seen ? new Date(seen).getTime() : null;
  const lines = [];
  const open = new Map();
  for (const r of rows) {
    const at = new Date(r.created_at).getTime();
    let line = open.get(r.kind);
    if (!line || line.oldestMs - at > ACCOUNT_BURST_MS) {
      line = {
        kind: r.kind,
        at: new Date(at).toISOString(),
        oldestMs: at,
        events: 0,
        players: new Map(),
        clans: new Map(),
      };
      open.set(r.kind, line);
      lines.push(line);
    }
    line.oldestMs = at;
    line.events += 1;
    if (r.player_tag) line.players.set(r.player_tag, r.name ?? null);
    else if (r.clan_tag) line.clans.set(r.clan_tag, r.name ?? null);
  }
  const items = lines.slice(0, LIST_CAP).map((l) => {
    const named = [...l.players, ...l.clans].slice(0, 3);
    return {
      kind: l.kind,
      at: l.at,
      events: l.events,
      players: l.players.size,
      clans: l.clans.size,
      subjects: named.map(([tag, name]) => ({
        tag,
        name,
        kind: l.players.has(tag) ? "player" : "clan",
      })),
      new: seenMs === null || Date.parse(l.at) > seenMs,
    };
  });
  return { items, new: items.filter((i) => i.new).length };
}

/** New Stamps of the last seven days, one line per Stamp per pass. A pass
 *  stamps every level it grants with one instant, so the levels of one
 *  pass group into one line at the highest; a retry or a racing pass adds
 *  no row, so it adds no line.
 *
 *  Legacy rows (#1015, 0272: earned before the passport's launch) are
 *  never such a line. An account that has them gets one "Your passport is
 *  ready" line instead, at the first one's instant (its first settle
 *  after the deploy, or the operator's backfill), while that is recent
 *  like the rest of the account's lines; it is one line however many
 *  passes filed them. One statement for both. */
async function readStampLines(db, accountId, seen) {
  const { rows } = await db.query(
    `(select false as ready, stamp_id, max(level)::int as level, earned_at,
             null::int as stamps
        from account_stamp_earned
       where account_id = $1::uuid and legacy_before is null
         and earned_at > now() - make_interval(days => $2::int)
       group by stamp_id, earned_at
       order by earned_at desc, stamp_id
       limit $3::int)
     union all
     (select true, null, null, min(earned_at),
             count(distinct stamp_id)::int
        from account_stamp_earned
       where account_id = $1::uuid and legacy_before is not null
      having min(earned_at) > now() - make_interval(days => $2::int))`,
    [accountId, ACCOUNT_DAYS, LIST_CAP],
  );
  return [
    ...stampLines(
      rows.filter((r) => !r.ready),
      seen,
    ),
    ...passportReadyLine(rows.find((r) => r.ready) ?? null, seen),
  ];
}

/** The legacy rows' first instant and Stamp count → the line. */
function passportReadyLine(row, seen) {
  if (!row?.earned_at || !(row.stamps > 0)) return [];
  const at = new Date(row.earned_at).toISOString();
  const seenMs = seen ? new Date(seen).getTime() : null;
  return [
    {
      kind: "passport_ready",
      stamps: Number(row.stamps),
      at,
      events: 1,
      players: 0,
      clans: 0,
      subjects: [],
      new: seenMs === null || Date.parse(at) > seenMs,
    },
  ];
}

/** Earned groups → bell lines. Pure, for the tests. */
export function stampLines(rows, seen) {
  const seenMs = seen ? new Date(seen).getTime() : null;
  return rows
    .filter((r) => stampById(r.stamp_id))
    .map((r) => {
      const at = new Date(r.earned_at).toISOString();
      return {
        kind: "stamp_earned",
        stamp_id: r.stamp_id,
        name: stampById(r.stamp_id).name,
        level: Number(r.level),
        levels: levelCount(r.stamp_id),
        at,
        events: 1,
        players: 0,
        clans: 0,
        subjects: [],
        new: seenMs === null || Date.parse(at) > seenMs,
      };
    });
}

/** Your account's lines and new Stamps, newest first, one cap. */
export function mergeAccountLines(lines, stamps) {
  const items = [...lines.items, ...stamps]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, LIST_CAP);
  return { items, new: items.filter((i) => i.new).length };
}

/** The bell's four sections and how many things in them are new. */
export async function readBell(
  db,
  accountId,
  { wake = null, perf = null } = {},
) {
  const seen = await seenAt(db, accountId);
  const own = await ownVerifiedPlayers(db, accountId);
  // The bell's own shape: the channels' extra counts stay out of it.
  const read = await readReactions(db, accountId, own, seen, { wake, perf });
  const reactions = {
    items: read.items.map(({ fresh: _f, subject_tag: _s, ...it }) => it),
    new: read.new,
  };
  const followers = await readFollowers(db, accountId, own, seen);
  const answers = await readAnswers(db, accountId);
  const account = mergeAccountLines(
    await readAccountLines(db, accountId, seen),
    await readStampLines(db, accountId, seen),
  );
  return {
    seen_at: seen,
    players: own.length,
    new: reactions.new + followers.new + answers.new + account.new,
    reactions,
    followers,
    answers,
    account,
  };
}
