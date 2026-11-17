import { readMembershipCapture } from "@elixir-mcp/record/membership-capture";

/** A new primary's first day, with three minutes after its profile arrives
 * to ask for a missing roster. A delayed collector must not spend that window
 * before the clan can be known. The allowance is one minted read a day.
 */
const ONBOARDING_DAY_MS = 24 * 60 * 60_000;
const ONBOARDING_WINDOW_MS = 3 * 60_000;
const BUCKET = "onboardingclan#";

export async function onboardingPeople(db, accountId, now = Date.now()) {
  const { rows } = await db.query(
    `select c.player_tag, c.created_at, p.last_known_clan_tag, cl.name,
            (select last_admitted_at from poll_state
              where subject_tag = p.last_known_clan_tag and endpoint = 'clan') as read_at,
            (select min(j.created_at) from job j
              where j.endpoint = 'clan' and j.entity_key = p.last_known_clan_tag
                and j.lane = 'live' and j.created_at >= c.created_at) as requested_at,
            exists (select 1 from account_clan ac join recording r
                      on r.subject_type = 'clan' and r.subject_tag = ac.clan_tag
                     and r.status = 'active'
                     where ac.account_id = c.account_id
                       and ac.clan_tag = p.last_known_clan_tag) as followed,
            exists (select 1 from account_clan_declined d
                     where d.account_id = c.account_id
                       and d.clan_tag = p.last_known_clan_tag) as declined,
            exists (select 1 from rate_limit
                     where bucket = $2 and window_start = (now() at time zone 'UTC')::date
                       and count >= 1) as spent
       from claim c join player p on p.player_tag = c.player_tag
       left join clan cl on cl.clan_tag = p.last_known_clan_tag
      where c.account_id = $1 and c.is_primary limit 1`,
    [accountId, `${BUCKET}${accountId}`],
  );
  const p = rows[0];
  const result = {
    player_tag: p?.player_tag ?? null,
    clan: null,
    state: "no_player",
    may_request: false,
    poll_ms: null,
  };
  if (!p) return result;
  const added = Date.parse(p.created_at);
  if (!(now - added >= 0 && now - added < ONBOARDING_DAY_MS))
    return { ...result, state: "finished" };
  const capture = (await readMembershipCapture(db, [p.player_tag])).get(
    p.player_tag,
  );
  const poll = now - added < ONBOARDING_WINDOW_MS ? 5000 : 60_000;
  if (!capture || capture.state === "unknown")
    return { ...result, state: "profile", poll_ms: poll };
  if (capture.state === "none") return { ...result, state: "no_clan" };
  if (!p.last_known_clan_tag)
    return { ...result, state: "profile", poll_ms: poll };
  result.clan = { tag: p.last_known_clan_tag, name: p.name ?? null };
  if (p.declined) return { ...result, state: "unfollowed" };
  if (p.followed && p.read_at)
    return {
      ...result,
      state: "ready",
      read_at: new Date(p.read_at).toISOString(),
    };
  const profile = Math.max(added, Date.parse(capture.observed_at));
  // Once a roster was requested, later profile observations cannot extend
  // its waiting window. The ledger already holds that durable timestamp.
  const start = p.requested_at
    ? Math.min(profile, Date.parse(p.requested_at))
    : profile;
  if (!(now - start < ONBOARDING_WINDOW_MS))
    return {
      ...result,
      state: "waiting",
      poll_ms: p.requested_at ? 60_000 : null,
    };
  if (!p.followed)
    // The profile commits before its courtesy follow. Read again, but never
    // replace a choice or take a clan slot on this route.
    return { ...result, state: "unfollowed", poll_ms: 5000 };
  return { ...result, state: "roster", may_request: !p.spent, poll_ms: 5000 };
}

class AllowanceSpent extends Error {}

/** No request names a tag: only the current primary's already-followed clan
 * may be read. makeLive owns cache/open-job reuse and the global token. Its
 * beforeMint callback spends this allowance only when a new fetch is possible.
 */
export async function requestOnboardingPeople(db, accountId, live) {
  const state = await onboardingPeople(db, accountId);
  if (!state.may_request || !live) return { ...state, queued: false };
  let spent = null;
  const refund = () =>
    db.query(
      `update rate_limit set count = count - 1 where bucket = $1
       and window_start = $2 and count > 0`,
      [`${BUCKET}${accountId}`, spent],
    );
  try {
    const read = await live(db, {
      endpoint: "clan",
      entityKey: state.clan.tag,
      beforeMint: async () => {
        const { rows } = await db.query(
          `insert into rate_limit (bucket, window_start, count)
           select $1, (now() at time zone 'UTC')::date, 1
            where exists (
              select 1 from claim c join player p on p.player_tag = c.player_tag
                join account_clan ac on ac.account_id = c.account_id and ac.clan_tag = $2
                join recording r on r.subject_type = 'clan' and r.subject_tag = ac.clan_tag and r.status = 'active'
               where c.account_id = $3 and c.is_primary and c.player_tag = $4
                 and p.last_known_clan_tag = $2)
           on conflict (bucket, window_start) do update set count = rate_limit.count + 1
             where rate_limit.count < 1 returning window_start`,
          [
            `${BUCKET}${accountId}`,
            state.clan.tag,
            accountId,
            state.player_tag,
          ],
        );
        if (!rows.length) throw new AllowanceSpent();
        spent = rows[0].window_start;
      },
    });
    if (spent && read.minted === false) await refund();
    return {
      ...state,
      may_request: false,
      queued: read.reason === "pending" && read.queued !== false,
      reason: read.reason ?? "fresh",
    };
  } catch (error) {
    if (spent) await refund();
    if (!(error instanceof AllowanceSpent))
      console.error("onboarding_people_failed", error?.message);
    return {
      ...state,
      may_request: false,
      queued: false,
      reason:
        error instanceof AllowanceSpent ? "allowance_spent" : "unavailable",
    };
  }
}
