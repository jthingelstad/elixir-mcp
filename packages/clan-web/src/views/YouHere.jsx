import { Fresh, Icon } from "@elixir-mcp/ui";
import { useMemberView } from "../lib/queries.js";
import { RoleChip } from "../components/RoleChip.jsx";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { CLAN, clanPath } from "../lib/base.js";

const STATUS = {
  holding: ["Holding Elder", "chip--ok"],
  slipping: ["Slipping", "chip--warn"],
  rising: ["Rising", "chip--info"],
  participating: ["Participating", "chip--mute"],
  quiet: ["Quiet", "chip--mute"],
};
const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
const MINIMUM = {
  war: ["war deck", "war decks"],
  ranked: ["ranked battle", "ranked battles"],
  donations: ["donation a week", "donations a week"],
  trophies: ["trophy", "trophies"],
};
/** How many races the chart draws; every race stays in the table. */
const CHART = 5;
const WORDS = ["", "one", "two", "three", "four", "five"];
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());
/** A date as the canvas writes it ("Sep 21"). Weeks and races turn on
 *  UTC boundaries, so the day is read in UTC, as The week reads it. */
const date = (ts) =>
  ts
    ? new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const race = (w) => `${w.season_id}/${w.section_index}`;
const ordinal = (k) =>
  k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : `${k}th`;

/** The panels' heads: a title, and the chip that says whether the
 *  clan's active policy counts this (only once there is one). */
function Head({ id, title, counted, children }) {
  return (
    <div className="panel__head flex-wrap gap-2">
      <h2 id={id} className="m-0 grow text-[14px] font-semibold">
        {title}
      </h2>
      {counted === false ? (
        <span className="chip chip--mute">Not counted here</span>
      ) : null}
      {children}
    </div>
  );
}

/** Your war decks in the last races, as columns: what you played, out of
 *  what the race asked. A race Elixir did not read is a dash, not a 0. */
function Races({ races }) {
  const shown = races.slice(-CHART);
  const top = Math.max(
    16,
    ...shown.map((w) => w.decks_asked ?? 0),
    ...shown.map((w) => w.decks ?? 0),
  );
  const said = shown
    .map(
      (w) =>
        `${race(w)} ${w.decks === null ? "not read" : w.decks}${w.decks_asked !== null && w.decks !== null ? ` of ${w.decks_asked}` : ""}${w.open ? " so far" : ""}`,
    )
    .join(", ");
  return (
    <div
      role="img"
      aria-label={`Your war decks: ${said}`}
      className="flex items-end gap-2.5"
    >
      {shown.map((w) => {
        const h = w.decks === null ? 2 : Math.round((64 * w.decks) / top);
        return (
          <span
            key={race(w)}
            className="flex-1 grid justify-items-center gap-1"
            aria-hidden="true"
          >
            <svg
              className="block w-full max-w-[64px] h-16"
              viewBox="0 0 10 64"
              preserveAspectRatio="none"
            >
              <rect
                y={64 - h}
                width="10"
                height={h}
                className={
                  w.decks === null
                    ? "fill-ground-sunken"
                    : w.open
                      ? "fill-accent-bright"
                      : "fill-accent"
                }
              />
            </svg>
            <span className="font-mono text-[12px] text-ink">
              {w.decks === null ? "—" : w.decks}
            </span>
            <span className="text-[11px] text-ink-faint">
              {race(w)}
              {w.open ? " · now" : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * "You here": one member's own page in this clan (round 4, 2026-09-25;
 * redrawn to the October 2026 canvas). Your numbers this week and week by
 * week work for any clan; what the clan's policy makes of them (what it
 * counts, your minimums, what would move you, your clock) shows once the
 * policy is active. Only you.
 */
export function YouHere({ clan, navigate }) {
  const { state } = useMemberView(clan.clan_tag);
  const d = state.data;
  const base = clanPath(clan.clan_tag);
  const go = (path) => (e) => {
    if (!navigate) return;
    e.preventDefault();
    navigate(path);
  };
  const y = d?.you;
  const since = y?.time_here.events.find(
    (e) => e.type === "role_changed" && e.role_after === y.role,
  );
  const head = (
    <PageHead
      clan={clan}
      name={d?.clan_name}
      crumb="You here"
      title="You here"
      lede="Your own numbers in this clan, week by week, and what its policy makes of them. Only you see this page."
      navigate={navigate}
      fresh={
        d?.as_of ? (
          <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
        ) : null
      }
    >
      {y ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="yours">★</span>
          <span className="text-[15px] font-semibold">
            {y.name ?? y.player_tag}
          </span>
          <span className="tag">{y.player_tag}</span>
          <RoleChip role={y.role} label={ROLE[y.role] ?? y.role} />
          {since ? (
            <span className="text-[13px] text-ink-dim">
              since {date(since.at)}
            </span>
          ) : null}
        </div>
      ) : null}
    </PageHead>
  );
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet."
              : state.error === "not_on_roster"
                ? "Elixir's record does not show you on this clan's roster yet."
                : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading your record…</p>
      </>
    );
  const c = d.clan;
  // Only an active policy says what counts; without one, nothing is
  // marked either way.
  const counted = (k) => (c ? (c.counted ?? []).includes(k) : undefined);
  const s = c?.status ? STATUS[c.status] : null;
  const war = y.this_war_week;
  const weeks = [...y.weeks].reverse();
  const races = y.war_weeks;
  const closed = races.slice(-CHART).filter((w) => !w.open);
  const played = closed.reduce((k, w) => k + (w.decks ?? 0), 0);
  const asked = closed.every((w) => w.decks !== null && w.decks_asked !== null)
    ? closed.reduce((k, w) => k + w.decks_asked, 0)
    : null;
  const elder = `${base}/standing`;
  return (
    <>
      {head}

      {d.open_actions ? (
        <a
          className="panel flex items-center gap-3 px-4 py-3.5 mb-[22px] text-ink no-underline hover:bg-panel-raised"
          href={`${base}/actions`}
          onClick={go(`${base}/actions`)}
        >
          <span className="flex items-center justify-center w-[34px] h-[34px] rounded-control bg-info-fill text-accent-bright">
            <Icon name="inbox" size={17} />
          </span>
          <span className="grow text-[14.5px] font-semibold">
            {d.open_actions} action{d.open_actions === 1 ? " waits" : "s wait"}{" "}
            for you
          </span>
          <span aria-hidden="true" className="text-ink-faint">
            ›
          </span>
        </a>
      ) : null}

      <h2 className="label mt-0 mb-2.5">This week so far</h2>
      <Tiles label="This week so far">
        {war ? (
          <Tile
            label="War decks"
            value={n(war.decks)}
            of={war.decks_asked !== null ? `of ${war.decks_asked}` : undefined}
            hint={
              counted("war") === false
                ? "Not counted here"
                : `Race ${race(war)}, four a war day`
            }
          />
        ) : null}
        <Tile
          label="Ranked battles"
          value={n(y.this_week?.ranked_battles)}
          hint={counted("ranked") === false ? "Not counted here" : undefined}
        />
        <Tile
          label="Donations"
          value={n(y.this_week?.donations)}
          hint={counted("donations") === false ? "Not counted here" : undefined}
        />
        <Tile label="Battles" value={n(y.this_week?.battles)} />
        <Tile
          label="Trophies"
          value={n(y.trophies)}
          hint={counted("trophies") === false ? "Not counted here" : undefined}
        />
      </Tiles>

      <div className="grid gap-4 items-start wide:grid-cols-3">
        <div className="grid gap-4 min-w-0 wide:col-span-2">
          <section className="panel" aria-labelledby="you-doing">
            <Head id="you-doing" title="How you are doing here">
              {s ? <span className={`chip ${s[1]}`}>{s[0]}</span> : null}
            </Head>
            <div className="panel__body grid gap-3">
              {c ? (
                <>
                  <p className="m-0">
                    {c.evidence ||
                      "Nothing recorded yet in what the clan counts."}
                  </p>
                  {c.next.map((line) => (
                    <p key={line} className="m-0 text-[13.5px] text-ink-dim">
                      → {line}
                    </p>
                  ))}
                  {Object.keys(c.minimums.set).length ? (
                    <div className="grid gap-1.5">
                      <h3 className="label m-0">
                        Minimums (
                        {c.minimums.rule === "all" ? "all of" : "any one of"},
                        over {c.minimums.window_weeks} weeks)
                      </h3>
                      <ul className="m-0 p-0 list-none grid gap-1">
                        {Object.entries(c.minimums.set).map(([k, need]) => {
                          const met = c.minimums.met[k];
                          return (
                            <li key={k} className="flex items-center gap-2">
                              <span
                                className={
                                  met === true
                                    ? "text-ok"
                                    : met === false
                                      ? "text-warn"
                                      : "text-ink-faint"
                                }
                              >
                                <Icon
                                  name={
                                    met === true
                                      ? "circle-check"
                                      : met === false
                                        ? "x"
                                        : "circle-dashed"
                                  }
                                  size={15}
                                />
                              </span>
                              <span>
                                {n(need)}{" "}
                                {MINIMUM[k]?.[need === 1 ? 0 : 1] ?? k}
                                <span className="sr-only">
                                  {met === true
                                    ? ": met"
                                    : met === false
                                      ? ": not met"
                                      : ": not known yet"}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {c.tenure_min_days != null && y.time_here.tenure_known ? (
                    <p className="m-0 text-[13.5px] text-ink-dim">
                      {y.time_here.days >= c.tenure_min_days
                        ? `${y.time_here.days} days in the clan: past the ${c.tenure_min_days} days Elder asks for.`
                        : `${y.time_here.days} of the ${c.tenure_min_days} days in the clan Elder asks for.`}
                    </p>
                  ) : null}
                  {c.inactivity && c.inactivity.state !== "none" ? (
                    <div className="callout callout--warn">
                      <span>
                        {c.inactivity.judgment === "held"
                          ? `Activity is uncertain. ${c.inactivity.activity_evidence?.reason ?? "Comparable observations do not cover the policy window."}`
                          : `The observed activity clock is ${Math.floor(c.inactivity.days_idle)} days; this clan counts a member at risk from ${c.inactivity.at_risk_days}.`}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : d.policy.set ? (
                <p className="m-0 text-ink-dim">
                  Clan management starts at {d.min_members} members; this clan
                  has {d.members}. Your numbers are below.
                </p>
              ) : (
                <p className="m-0 text-ink-dim">
                  This clan&rsquo;s leaders have not set up how the clan runs
                  here yet. Your numbers are below.
                </p>
              )}
              {d.hold ? (
                <div className="notice">
                  {d.hold.kind === "away"
                    ? "You are marked away"
                    : "A leader has you on hold"}
                  {d.hold.until ? ` until ${date(d.hold.until)}` : ""}.
                </div>
              ) : null}
            </div>
            {c ? (
              <div className="panel__foot">
                <a href={elder} onClick={go(elder)}>
                  {c.ranks_elder ? "How Elder works here" : "How it works here"}{" "}
                  ›
                </a>
              </div>
            ) : null}
          </section>

          {races.length ? (
            <section className="panel" aria-labelledby="you-war">
              <Head
                id="you-war"
                title={
                  races.length === 1
                    ? "War decks, last race"
                    : `War decks, last ${WORDS[Math.min(races.length, CHART)]} races`
                }
                counted={counted("war")}
              />
              <div className="panel__body grid gap-3">
                <Races races={races} />
                {asked !== null && closed.length ? (
                  <p className="m-0 text-[13px] text-ink-dim">
                    {played} of {asked} in the finished race
                    {closed.length === 1 ? "" : "s"}.
                  </p>
                ) : null}
              </div>
              <div tabIndex={0} className="table__scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Race</th>
                      <th>Decks played</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...races].reverse().map((w) => (
                      <tr key={race(w)}>
                        <td>
                          {race(w)}
                          {w.is_colosseum ? " · Colosseum" : ""}
                          {w.open ? " (so far)" : ""}
                        </td>
                        <td>
                          {n(w.decks)}
                          {w.decks_asked != null ? ` of ${w.decks_asked}` : ""}
                        </td>
                        <td>{n(w.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel" aria-labelledby="you-weeks">
            <Head id="you-weeks" title="Week by week" />
            <div tabIndex={0} className="table__scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Battles</th>
                    <th>Ranked</th>
                    <th>Donations</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.from}>
                      <td>
                        {w.complete
                          ? `Week of ${date(w.from)}`
                          : "This week, so far"}
                      </td>
                      <td>{n(w.battles)}</td>
                      <td>{n(w.ranked_battles)}</td>
                      <td>{n(w.donations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="grid gap-4 min-w-0">
          <section className="panel" aria-labelledby="you-time">
            <Head id="you-time" title="Your time here" />
            <div className="panel__body grid gap-2">
              <p className="m-0">
                {y.time_here.tenure_known && y.time_here.joined_observed_at
                  ? `Joined ${date(y.time_here.joined_observed_at)}: ${y.time_here.days} days.`
                  : `Here since before the record began (${date(y.time_here.recording_since)}): at least ${y.time_here.days ?? "?"} days.`}
              </p>
              {y.time_here.events
                .filter((e) => e.type === "role_changed")
                .map((e) => (
                  <p key={e.at} className="m-0 text-[13.5px] text-ink-dim">
                    {date(e.at)}: {ROLE[e.role_before] ?? e.role_before ?? "?"}{" "}
                    → {ROLE[e.role_after] ?? e.role_after ?? "?"}
                  </p>
                ))}
            </div>
          </section>

          {d.trophies.length ? (
            <section className="panel" aria-labelledby="you-trophies">
              <Head id="you-trophies" title="Your trophies here" />
              <ul className="m-0 p-0 list-none">
                {d.trophies.map((g) => (
                  <li
                    key={`${g.season_id}-${g.award_id}`}
                    className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line-row last:border-b-0"
                  >
                    <span className="text-accent-bright">
                      <Icon name="award" size={16} />
                    </span>
                    <span className="grow">
                      {g.name}
                      {g.manual ? "" : ` · ${ordinal(g.rank)}`}
                    </span>
                    <span className="text-[12.5px] text-ink-faint">
                      season {g.season_id}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
