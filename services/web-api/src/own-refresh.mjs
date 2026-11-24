/**
 * Your own battles, read now (2026-11-14). The owner opened Elixir to share
 * a win he had just played and it was not there: a battle log is read on
 * the scheduler's cadence, not when its player shows up. Opening the app,
 * the freshness chip, the battle-post composer and your own player page ask
 * the live lane (packages/tools live.mjs) for a RECORDING read of your own
 * verified players' battle logs, so the app feels live for the person
 * using it, within limits:
 *
 *  - Your own verified players only, the primary first, at most three
 *    (MAX_PLAYERS). Never a player you only follow: following someone does
 *    not make their log read on your open.
 *  - A log read in the last two minutes is fresh enough (FRESH_ENOUGH_S);
 *    the lane itself answers inside the API's 60-second cache, and this
 *    widens it so reopening the app spends nothing.
 *  - One ask per account per five minutes (FLOOR_S), however many tabs or
 *    devices ask: account.own_refresh_at (0270), moved by one conditional
 *    UPDATE, so two asks at once cannot both pass.
 *  - Every read the lane mints takes one token from the one global bucket
 *    first, exactly as any live read does; with none left nothing is
 *    queued and nothing is charged.
 *  - Then a daily allowance per person, REFRESH_DAY, the size of the
 *    person's live quota (liveBudgetFor: 20 a day for Member, 100 Leader,
 *    250 Family, 1,000 Partner, none for the owner and admins) but its own
 *    bucket, so opening the app can never use up the live reads a person
 *    or their agent asks for over MCP [engineering, 2026-11-14; the split
 *    is in the note and the pull request]. Verification spends neither.
 *
 * A refusal anywhere (no token, the allowance spent, the floor) is an
 * answer, never an error: `queued: false`, and each player says `skipped`.
 */
import { latestSnapshotOrder } from "@elixir-mcp/record/latest-snapshot";
import { rankedLeagueName } from "@elixir-mcp/record/ranked-leagues";
import { liveBudgetFor } from "@elixir-mcp/tools/shared";
import { ownVerifiedPlayers } from "@elixir-mcp/tools/activity/home-feed";

export const FLOOR_S = 300;
export const FRESH_ENOUGH_S = 120;
export const MAX_PLAYERS = 3;
/** The day's own-battle reads, per person: `refreshday#<account>` in
 *  rate_limit, windowed by UTC date like `liveday#`. */
export const REFRESH_DAY = "refreshday#";

const ENDPOINT = "player_battlelog";
/** The profile, read only on a tap of Check for new battles (2026-11-23). */
const PROFILE = "player";

/** Your own verified players, primary first, at most MAX_PLAYERS. */
export async function ownPlayers(db, accountId) {
  return (await ownVerifiedPlayers(db, accountId))
    .slice(0, MAX_PLAYERS)
    .map((p) => p.tag);
}

/** One player's battle log (or, with `endpoint`, their profile) as the
 *  record has it: when it was last read into the record, whether a read is
 *  queued or leased, and whether Elixir records the player at all. One
 *  read per player, never a batch. */
async function logState(db, tag, endpoint = ENDPOINT) {
  const {
    rows: [s],
  } = await db.query(
    `select (select max(r.fetched_at) from api_receipt r
              where r.endpoint = $2::text and r.entity_key = $1::text
                and r.replay_retired_at is null) as read_at,
            exists (select 1 from job j
                     where j.endpoint = $2::text and j.entity_key = $1::text
                       and j.status in ('queued', 'leased')) as pending,
            exists (select 1 from recording
                     where subject_type = 'player' and subject_tag = $1::text
                       and status = 'active' and scope = 'comprehensive') as recorded`,
    [tag, endpoint],
  );
  return {
    readAt: s.read_at ? new Date(s.read_at) : null,
    pending: s.pending === true,
    recorded: s.recorded === true,
  };
}

const ageS = (at, now) =>
  at ? (now.getTime() - at.getTime()) / 1000 : Infinity;

/** Pass the floor, or say how long until it opens. */
async function takeFloor(db, accountId) {
  const { rows } = await db.query(
    `update account set own_refresh_at = now()
      where account_id = $1::uuid
        and (own_refresh_at is null
             or own_refresh_at <= now() - make_interval(secs => $2::int))
      returning own_refresh_at`,
    [accountId, FLOOR_S],
  );
  if (rows.length) return { ok: true };
  const {
    rows: [w],
  } = await db.query(
    `select greatest(1, ceil(extract(epoch from
              own_refresh_at + make_interval(secs => $2::int) - now())))::int as s
       from account where account_id = $1::uuid`,
    [accountId, FLOOR_S],
  );
  return { ok: false, retry_after_s: w?.s ?? FLOOR_S };
}

class AllowanceSpent extends Error {}

/** Take one of the person's own-battle reads for today. A refusal leaves
 *  the count alone, so it is always the reads taken and not given back. */
async function spendAllowance(db, account) {
  const { cap } = liveBudgetFor(account);
  if (cap === Infinity) return { bucket: null };
  if (!(cap >= 1)) throw new AllowanceSpent();
  const bucket = `${REFRESH_DAY}${account.accountId}`;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1::text, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
       where rate_limit.count < $3::int
     returning count`,
    [bucket, day, cap],
  );
  if (!rows.length) throw new AllowanceSpent();
  return { bucket, day };
}

async function refundAllowance(db, spent) {
  if (!spent?.bucket) return;
  await db.query(
    `update rate_limit set count = count - 1
      where bucket = $1::text and window_start = $2::date and count > 0`,
    [spent.bucket, spent.day],
  );
}

/**
 * Ask for your own players' battle logs now. `live` is the lane
 * (makeLive). Answers { queued, players: [{tag, state, retry_after_s?}] }:
 * `fresh` (read in the last two minutes, or the lane had a read in hand),
 * `queued` (a read is on its way: this ask's, or one already open), or
 * `skipped` (the floor, the bucket, the allowance, or a log Elixir does
 * not record). `queued` is whether any read is on its way.
 */
export async function refreshOwn(db, live, account, { now = new Date() } = {}) {
  const tags = await ownPlayers(db, account.accountId);
  if (tags.length === 0) return { queued: false, players: [] };
  const floor = await takeFloor(db, account.accountId);
  const players = [];
  // Once the bucket or the allowance says no, nobody else is asked.
  let refused = floor.ok ? null : { retry_after_s: floor.retry_after_s };
  const outcomes = [];
  for (const tag of tags) {
    const s = await logState(db, tag);
    if (ageS(s.readAt, now) <= FRESH_ENOUGH_S) {
      players.push({ tag, state: "fresh" });
      outcomes.push("fresh");
      continue;
    }
    if (s.pending) {
      await joinOpen(db, live, tag);
      players.push({ tag, state: "queued", retry_after_s: 15 });
      outcomes.push("open");
      continue;
    }
    if (!s.recorded) {
      players.push({ tag, state: "skipped" });
      outcomes.push("not_recorded");
      continue;
    }
    if (refused) {
      players.push({ tag, state: "skipped", ...refused });
      outcomes.push(floor.ok ? "refused" : "floor");
      continue;
    }
    let spent = null;
    try {
      const r = await live(db, {
        endpoint: ENDPOINT,
        entityKey: tag,
        record: true,
        // Charged only when a read is minted, after the global token:
        // throwing here gives the token back (live.mjs).
        beforeMint: async () => {
          spent = await spendAllowance(db, account);
        },
      });
      if (spent && r.minted === false) await refundAllowance(db, spent);
      if (r.ok) {
        players.push({ tag, state: "fresh" });
        outcomes.push("fresh");
      } else if (r.reason === "pending" && r.queued === false) {
        refused = { retry_after_s: r.retry_after_s };
        players.push({ tag, state: "skipped", ...refused });
        outcomes.push("no_token");
      } else if (r.reason === "pending") {
        players.push({ tag, state: "queued", retry_after_s: r.retry_after_s });
        outcomes.push(r.minted ? "minted" : "joined");
      } else {
        players.push({ tag, state: "skipped" });
        outcomes.push(r.reason ?? "skipped");
      }
    } catch (err) {
      if (err instanceof AllowanceSpent) {
        refused = {};
        players.push({ tag, state: "skipped" });
        outcomes.push("allowance_spent");
        continue;
      }
      if (spent) await refundAllowance(db, spent).catch(() => {});
      // Quiet to the person; the line says what failed, never whose.
      console.error(
        JSON.stringify({ at: "own_refresh_failed", code: err?.code ?? null }),
      );
      players.push({ tag, state: "skipped" });
      outcomes.push("error");
    }
  }
  // By outcome only: no tag, account or email in the line.
  console.info(JSON.stringify({ at: "own_refresh", outcomes }));
  return { queued: players.some((p) => p.state === "queued"), players };
}

/**
 * Whether the asked reads have landed, for the page that asked: per own
 * player when its log was last read and whether a read is still on its
 * way, and whether Home's stored week was built after the newest of those
 * reads. When it was not, the week is asked to build again (`wake`, the
 * timeline-sync lane, once per read), so a landed battle reaches the feed
 * without waiting for the quarter-hour rebuild. Reads only, apart from
 * that wake. With `tag` and `since` (your own player page's tapped check),
 * that player's entry also says what the check found (checkResult).
 */
export async function refreshStatus(
  db,
  accountId,
  { wake = null, now = new Date(), tag: asked = null, since = null } = {},
) {
  const tags = await ownPlayers(db, accountId);
  const players = [];
  let newest = null;
  for (const tag of tags) {
    const s = await logState(db, tag);
    players.push({
      tag,
      read_at: s.readAt ? s.readAt.toISOString() : null,
      pending: s.pending,
      ...(since && tag === asked ? await checkResult(db, tag, since) : {}),
    });
    if (s.readAt && (!newest || s.readAt > newest)) newest = s.readAt;
  }
  const {
    rows: [row],
  } = await db.query(
    `select built_at from home_feed where account_id = $1::uuid`,
    [accountId],
  );
  // No stored week: the next feed read builds one, with the read in it.
  const feedCurrent =
    !row || !newest || new Date(row.built_at).getTime() >= newest.getTime();
  if (!feedCurrent && wake)
    await wake(accountId, now.getTime(), {
      since: newest.toISOString(),
    }).catch((err) =>
      console.error(
        JSON.stringify({
          at: "own_refresh_wake_failed",
          code: err?.code ?? err?.name ?? null,
        }),
      ),
    );
  return { players, feed_current: feedCurrent };
}

/* ------------------------------------------------------------------------
 * Any player's battles, read now: the player page's button (2026-11-14).
 *
 * A deliberate tap, for one player, on anyone's page. Your own verified
 * players go through refreshOwn above (the same action as the chip). For
 * anyone else it is ONE recording read of their battle log, never the
 * start of a recording: the scheduler plans only players someone records
 * (or a recorded clan's members), so a one-off read leaves no schedule
 * behind. Its limits, all in the database:
 *
 *  - A log read in the last two minutes, or a read already on its way,
 *    answers `fresh` or `queued` and spends nothing.
 *  - One ask per account per player per two minutes (PLAYER_FLOOR_S): a
 *    `refreshone#<account>#<tag>` row in rate_limit keyed by the two-minute
 *    slot, inserted once (`on conflict do nothing`), so taps at once pass
 *    once. Across a slot's edge the read the first tap minted is still
 *    open, so the second one joins it rather than minting.
 *  - The one global bucket (the lane takes its token first).
 *  - OTHERS_PER_HOUR asks that reach the lane per account per hour
 *    (`refreshother#<account>`), then the person's live quota itself
 *    (`liveday#<account>`, liveBudgetFor), as any deliberate live read.
 *    A refusal gives back what was taken.
 *
 * Every refusal is `skipped` with `retry_after_s`; never an error.
 * ---------------------------------------------------------------------- */

/** One ask per account per player in this many seconds. */
export const PLAYER_FLOOR_S = 120;
/** Asks for other people's battles that reach the lane, per account per
 *  hour. Half a Member's live quota (20 a day), so a Member's day lasts at
 *  least two hours of tapping, and a Leader's 100 cannot go in one sitting.
 *  An account with an unlimited live quota (owner, admin, a family app;
 *  liveBudgetFor) is not held to it, as it is held to no live allowance;
 *  the per-player floor and the global bucket still hold for everyone. */
export const OTHERS_PER_HOUR = 10;
export const REFRESH_ONE = "refreshone#";
export const REFRESH_OTHERS = "refreshother#";

/** Whether Elixir knows this tag at all (a page exists for it). */
async function knownPlayer(db, tag) {
  const { rows } = await db.query(
    `select 1 from player where player_tag = $1::text`,
    [tag],
  );
  return rows.length > 0;
}

/** Pass this account's floor for one player, or say how long until it opens. */
async function takePlayerFloor(db, accountId, tag) {
  const { rows } = await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1::text, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
     on conflict (bucket, window_start) do nothing
     returning window_start`,
    [`${REFRESH_ONE}${accountId}#${tag}`, PLAYER_FLOOR_S],
  );
  if (rows.length) return { ok: true };
  const {
    rows: [w],
  } = await db.query(
    `select greatest(1, $1::int - (floor(extract(epoch from now()))::bigint % $1::int))::int as s`,
    [PLAYER_FLOOR_S],
  );
  return { ok: false, retry_after_s: w.s };
}

/** A read is already on its way: hand it to the lane anyway, which joins
 *  it without charging, turns a fetch-only `live_fetch` job into a
 *  recording one and lifts a queued bulk job onto the live lane. If the
 *  job finished in between, nothing is minted here (`NoMint`), so a join
 *  never spends a token or an allowance. */
class NoMint extends Error {}
async function joinOpen(db, live, tag, endpoint = ENDPOINT) {
  try {
    await live(db, {
      endpoint,
      entityKey: tag,
      record: true,
      beforeMint: async () => {
        throw new NoMint();
      },
    });
  } catch (err) {
    if (!(err instanceof NoMint)) throw err;
  }
}

class Refused extends Error {
  constructor(retryAfterS) {
    super("refused");
    this.retry_after_s = retryAfterS;
  }
}

/** The hour's asks, then the day's live quota; a refusal throws Refused
 *  having given back what it took. Returns what to give back later. */
async function spendForOther(db, account) {
  const budget = liveBudgetFor(account);
  if (budget.cap === Infinity) return [];
  const hour = `${REFRESH_OTHERS}${account.accountId}`;
  const {
    rows: [h],
  } = await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1::text, date_trunc('hour', now()), 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
       where rate_limit.count < $2::int
     returning window_start`,
    [hour, OTHERS_PER_HOUR],
  );
  if (!h) {
    const {
      rows: [w],
    } = await db.query(
      `select greatest(1, ceil(extract(epoch from date_trunc('hour', now()) + interval '1 hour' - now())))::int as s`,
    );
    throw new Refused(w.s);
  }
  const spent = [{ bucket: hour, window: h.window_start }];
  {
    const day = new Date().toISOString().slice(0, 10);
    const { rows } = await db.query(
      `insert into rate_limit (bucket, window_start, count) values ($1::text, $2::date, 1)
       on conflict (bucket, window_start) do update set count = rate_limit.count + 1
         where rate_limit.count < $3::int
       returning window_start`,
      [budget.bucket, day, budget.cap],
    );
    if (!rows.length) {
      await giveBack(db, spent);
      const {
        rows: [w],
      } = await db.query(
        `select greatest(1, ceil(extract(epoch from date_trunc('day', now() at time zone 'UTC') + interval '1 day' - (now() at time zone 'UTC'))))::int as s`,
      );
      throw new Refused(w.s);
    }
    spent.push({ bucket: budget.bucket, window: rows[0].window_start });
  }
  return spent;
}

async function giveBack(db, spent) {
  for (const s of spent ?? [])
    await db.query(
      `update rate_limit set count = count - 1
        where bucket = $1::text and window_start = $2::timestamptz and count > 0`,
      [s.bucket, s.window],
    );
}

/**
 * Ask for one player's battle log now. Your own verified player is your
 * own refresh (refreshOwn); anyone else is one read under the limits
 * above. Answers the same shape as refreshOwn, with one player.
 *
 * `tap` (2026-11-23): the person tapped Check for new battles on this
 * player's page, so the ask also reads the player's profile (readProfile)
 * and answers `since`, the marker the follow-up read takes to say what
 * the check found (checkResult). The app's own asks never send it.
 */
export async function refreshPlayer(
  db,
  live,
  account,
  tag,
  { now = new Date(), tap = false } = {},
) {
  const own = await ownPlayers(db, account.accountId);
  if (own.includes(tag)) {
    if (!tap) return refreshOwn(db, live, account, { now });
    const before = await profileFacts(db, tag);
    const answer = await refreshOwn(db, live, account, { now });
    const entry = answer.players.find((p) => p.tag === tag);
    const profile = await readProfile(db, live, tag, entry?.state, now);
    console.info(
      JSON.stringify({ at: "own_refresh_profile", outcome: profile.outcome }),
    );
    return {
      queued: answer.queued || profile.state === "queued",
      players: answer.players.map((p) =>
        p.tag === tag ? { ...p, profile: profile.state } : p,
      ),
      since: encodeSince(before),
    };
  }
  // What Elixir had before this ask: read first, so the check can say what
  // it changed.
  const before = tap ? await profileFacts(db, tag) : null;
  const { player, outcome } = await askOther(db, live, account, tag, now);
  const profile = tap
    ? await readProfile(db, live, tag, player.state, now)
    : null;
  console.info(
    JSON.stringify({
      at: "player_refresh",
      outcome,
      ...(profile ? { profile: profile.outcome } : {}),
    }),
  );
  if (!profile) return { queued: player.state === "queued", players: [player] };
  return {
    queued: player.state === "queued" || profile.state === "queued",
    players: [{ ...player, profile: profile.state }],
    since: encodeSince(before),
  };
}

/** Another player's battle log, under the limits above: `{ player,
 *  outcome }`, the player's answer and one word for the log line. */
async function askOther(db, live, account, tag, now) {
  const answer = (player, outcome) => ({ player, outcome });
  if (!(await knownPlayer(db, tag)))
    return answer({ tag, state: "skipped" }, "unknown");
  const s = await logState(db, tag);
  if (ageS(s.readAt, now) <= FRESH_ENOUGH_S)
    return answer({ tag, state: "fresh" }, "fresh");
  if (s.pending) {
    await joinOpen(db, live, tag);
    return answer({ tag, state: "queued", retry_after_s: 15 }, "open");
  }
  const floor = await takePlayerFloor(db, account.accountId, tag);
  if (!floor.ok)
    return answer(
      { tag, state: "skipped", retry_after_s: floor.retry_after_s },
      "floor",
    );
  let spent = null;
  try {
    const r = await live(db, {
      endpoint: ENDPOINT,
      entityKey: tag,
      record: true,
      beforeMint: async () => {
        spent = await spendForOther(db, account);
      },
    });
    if (spent && r.minted === false) await giveBack(db, spent);
    if (r.ok) return answer({ tag, state: "fresh" }, "fresh");
    if (r.reason === "pending" && r.queued === false)
      return answer(
        { tag, state: "skipped", retry_after_s: r.retry_after_s },
        "no_token",
      );
    if (r.reason === "pending")
      return answer(
        { tag, state: "queued", retry_after_s: r.retry_after_s },
        r.minted ? "minted" : "joined",
      );
    return answer({ tag, state: "skipped" }, r.reason ?? "skipped");
  } catch (err) {
    if (err instanceof Refused)
      return answer(
        { tag, state: "skipped", retry_after_s: err.retry_after_s },
        "limit",
      );
    if (spent) await giveBack(db, spent).catch(() => {});
    console.error(
      JSON.stringify({ at: "player_refresh_failed", code: err?.code ?? null }),
    );
    return answer({ tag, state: "skipped" }, "error");
  }
}

/* ------------------------------------------------------------------------
 * The tapped player's profile (2026-11-23, the owner: "in addition to
 * pulling the player's battles let's also pull that player's profile
 * information and show any updates there").
 *
 *  - Only on a tap of Check for new battles, only for the page's player,
 *    and only when the battle-log half of the ask went ahead (`fresh` or
 *    `queued`): an ask a limit refused, or a player Elixir does not know,
 *    reads no profile either.
 *  - A profile read in the last PROFILE_FRESH_S is fresh enough, and a
 *    profile read already on its way is joined (never minted twice).
 *  - One token from the one global bucket, as every live read takes. It
 *    is the same ask for the person, so it spends none of their own
 *    allowances (refreshone#, refreshother#, liveday#, refreshday#). With
 *    no token, the profile is simply not read this time.
 *  - It never changes the battle log's answer: it is asked after it, and
 *    every refusal or failure is `skipped`.
 * ---------------------------------------------------------------------- */

/** A profile read this recently is fresh enough: profiles move slowly
 *  (trophies once a battle, a clan or a league far less often), and this
 *  keeps a person who checks after every battle to one profile read per
 *  player per ten minutes, however many taps. */
export const PROFILE_FRESH_S = 600;

async function readProfile(db, live, tag, logAnswer, now) {
  if (logAnswer !== "fresh" && logAnswer !== "queued")
    return { state: "skipped", outcome: "not_asked" };
  const s = await logState(db, tag, PROFILE);
  if (ageS(s.readAt, now) <= PROFILE_FRESH_S)
    return { state: "fresh", outcome: "fresh" };
  try {
    if (s.pending) {
      await joinOpen(db, live, tag, PROFILE);
      return { state: "queued", outcome: "open" };
    }
    const r = await live(db, {
      endpoint: PROFILE,
      entityKey: tag,
      record: true,
    });
    if (r.ok) return { state: "fresh", outcome: "fresh" };
    if (r.reason === "pending" && r.queued === false)
      return { state: "skipped", outcome: "no_token" };
    if (r.reason === "pending")
      return { state: "queued", outcome: r.minted ? "minted" : "joined" };
    return { state: "skipped", outcome: r.reason ?? "skipped" };
  } catch (err) {
    console.error(
      JSON.stringify({ at: "profile_refresh_failed", code: err?.code ?? null }),
    );
    return { state: "skipped", outcome: "error" };
  }
}

/* ------------------------------------------------------------------------
 * What the check found (2026-11-23). The ask reads what Elixir had before
 * it (profileFacts) and hands it back as `since`, a small opaque marker:
 * the ask's time on the database clock and those values. The follow-up
 * read (`GET /api/me/refresh?player_tag=&since=`) compares the record
 * with it. The marker is the reader's own echo of public game facts the
 * page already shows; a changed one can only change what that reader is
 * told, and one older than SINCE_MAX_S (or unreadable) is ignored.
 * ---------------------------------------------------------------------- */

/** A marker older than this says nothing: the slow path gives up well
 *  before it. */
export const SINCE_MAX_S = 900;

/** The profile facts a check compares, as the page and the record have
 *  them now: the name, the clan the latest profile named (null when no
 *  profile said), trophies and their arena from the latest snapshot (what
 *  the page's head shows), best trophies and the Ranked league from the
 *  latest profile, and when that profile was read. */
async function profileFacts(db, tag) {
  const {
    rows: [r],
  } = await db.query(
    // The marker keeps milliseconds and the database keeps microseconds:
    // rounded up, a row written before the ask in the same millisecond is
    // still older than the marker, never "new" (a check's own reads come
    // far later than a millisecond after it).
    `select date_trunc('milliseconds', now()) + interval '1 millisecond' as at,
            p.name, m.state as clan_state, m.clan_tag,
            c.name as clan_name, s.trophies, a.name as arena,
            pr.best_trophies, pr.pol_league, pr.profile_observed_at
       from (select $1::text as tag) x
       left join player p on p.player_tag = x.tag
       left join player_profile_membership m on m.player_tag = x.tag
       left join clan c on c.clan_tag = m.clan_tag
       left join lateral (
         select trophies, arena_id from player_snapshot_daily
          where player_tag = x.tag
          order by ${latestSnapshotOrder()} limit 1) s on true
       left join arena a on a.arena_id = s.arena_id
       left join lateral (
         select best_trophies, pol_league, profile_observed_at
           from player_snapshot_daily
          where player_tag = x.tag and snapshot_kind = 'daily'
            and profile_observed_at is not null
          order by profile_observed_at desc limit 1) pr on true`,
    [tag],
  );
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    at: iso(r.at),
    name: r.name ?? null,
    // [tag, name] in a clan, 0 in none, null when no profile said.
    clan:
      r.clan_state === "member" && r.clan_tag
        ? [r.clan_tag, r.clan_name ?? null]
        : r.clan_state === "none"
          ? 0
          : null,
    trophies: r.trophies ?? null,
    arena: r.arena ?? null,
    best: r.best_trophies ?? null,
    league: r.pol_league ?? null,
    observed: iso(r.profile_observed_at),
  };
}

/** The marker an ask answers: base64url JSON, short keys. */
export function encodeSince(f) {
  const o = {
    t: f.at,
    n: f.name,
    c: f.clan,
    tr: f.trophies,
    ar: f.arena,
    bt: f.best,
    lg: f.league,
    o: f.observed,
  };
  return Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
}

/** The marker back, checked: `{ at, facts }`, or null when it is not one,
 *  or is older than SINCE_MAX_S. */
export function decodeSince(raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048)
    return null;
  let o;
  try {
    o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const at = typeof o.t === "string" ? Date.parse(o.t) : NaN;
  if (!Number.isFinite(at)) return null;
  if (at < now - SINCE_MAX_S * 1000 || at > now + 60_000) return null;
  const str = (v) => (typeof v === "string" ? v.slice(0, 64) : null);
  const int = (v) => (Number.isInteger(v) ? v : null);
  const observed = typeof o.o === "string" ? Date.parse(o.o) : NaN;
  return {
    at: new Date(at),
    facts: {
      name: str(o.n),
      clan:
        o.c === 0
          ? 0
          : Array.isArray(o.c) && typeof o.c[0] === "string"
            ? [o.c[0].slice(0, 16), str(o.c[1])]
            : null,
      trophies: int(o.tr),
      arena: str(o.ar),
      best: int(o.bt),
      league: int(o.lg),
      observed: Number.isFinite(observed)
        ? new Date(observed).toISOString()
        : null,
    },
  };
}

/** What moved between two profile reads, in the order a player reads it.
 *  Nothing unless a profile newer than the one Elixir had has landed, and
 *  never for a first profile (there is nothing it changed). */
export function profileChanges(before, after) {
  if (!before?.observed || !after?.observed) return [];
  if (Date.parse(after.observed) <= Date.parse(before.observed)) return [];
  const out = [];
  if (before.name && after.name && before.name !== after.name)
    out.push({ field: "name", from: before.name, to: after.name });
  if (before.clan !== null && after.clan !== null) {
    const was = before.clan === 0 ? null : before.clan;
    const is = after.clan === 0 ? null : after.clan;
    if ((was?.[0] ?? null) !== (is?.[0] ?? null))
      out.push({
        field: "clan",
        from: was ? { tag: was[0], name: was[1] } : null,
        to: is ? { tag: is[0], name: is[1] } : null,
      });
  }
  const moved = (a, b) => a !== null && b !== null && a !== b;
  if (moved(before.trophies, after.trophies))
    out.push({ field: "trophies", from: before.trophies, to: after.trophies });
  if (moved(before.best, after.best) && after.best > before.best)
    out.push({ field: "best_trophies", from: before.best, to: after.best });
  if (moved(before.arena, after.arena))
    out.push({ field: "arena", from: before.arena, to: after.arena });
  const was = rankedLeagueName(before.league);
  const is = rankedLeagueName(after.league);
  if (was && is && was !== is) out.push({ field: "league", from: was, to: is });
  return out;
}

/**
 * What a tapped check found for one player, against `since` (decodeSince):
 * the battles Elixir stored for them after the ask (`new_battles`: a
 * battle's row is written once, the first time any read delivers it, so
 * this is exactly the battles Elixir did not have before), their newest
 * battle and whether it is one of those, and their profile: when it was
 * last read, whether a read is on its way, and what moved.
 */
/** How many of a player's newest battles a check's count reads: twice a
 *  battle log's 30, so a log that overlaps two reads is still counted. */
const NEW_BATTLES_REACH = 60;

export async function checkResult(db, tag, since) {
  const {
    rows: [b],
  } = await db.query(
    // A battle log carries the player's newest battles only (30 at most),
    // so whatever a check stored is among their newest rows: count there,
    // never across the year the record keeps for a recorded player.
    `select (select count(*) from (
               select bp.battle_id from battle_participant bp
                where bp.player_tag = $1::text
                order by bp.battle_time desc limit ${NEW_BATTLES_REACH}) r
               join battle bt on bt.battle_id = r.battle_id
              where bt.created_at >= $2::timestamptz)::int as new_battles,
            n.battle_time as newest_at,
            n.created_at >= $2::timestamptz as newest_is_new
       from (select 1) x
       left join lateral (
         select bp.battle_time, bt.created_at from battle_participant bp
           join battle bt on bt.battle_id = bp.battle_id
          where bp.player_tag = $1::text
          order by bp.battle_time desc limit 1) n on true`,
    [tag, since.at],
  );
  const profile = await logState(db, tag, PROFILE);
  const after = await profileFacts(db, tag);
  return {
    new_battles: b.new_battles,
    newest_battle_at: b.newest_at ? new Date(b.newest_at).toISOString() : null,
    latest_is_new: b.newest_is_new === true,
    profile_read_at: profile.readAt ? profile.readAt.toISOString() : null,
    profile_pending: profile.pending,
    profile_changes: profileChanges(since.facts, after),
  };
}

/** One player's follow-up read: when the log was last read, whether a read
 *  is on its way; with `since`, what the check found. Nothing private and
 *  nothing woken. */
export async function playerStatus(db, tag, { since = null } = {}) {
  const s = await logState(db, tag);
  return {
    players: [
      {
        tag,
        read_at: s.readAt ? s.readAt.toISOString() : null,
        pending: s.pending,
        ...(since ? await checkResult(db, tag, since) : {}),
      },
    ],
    feed_current: true,
  };
}
