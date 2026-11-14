import {
  Fresh,
  Icon,
  noun,
  Tag,
  Link,
  Panel,
  Table,
  ErrorState,
} from "@elixir-mcp/ui";
import { useMemberView } from "../lib/queries.js";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { HowYouAreDoing, statusChip } from "../components/YouHereCard.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { ROLE, date, n, ordinal, seasonWeek } from "../lib/words.js";

/** How many races the chart draws; every race stays in the table. */
const CHART = 5;
const WORDS = ["", "one", "two", "three", "four", "five"];
const race = (w) => seasonWeek(w);

/** The panels' heads: a title, and the chip that says whether the
 *  clan's active policy counts this (only once there is one). */
function Head({ id, title, counted, children }) {
  return (
    <div className="panel__head flex-wrap gap-2">
      <h3 id={id} className="kit-panel__title grow">
        {title}
      </h3>
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
              Week {w.section_index + 1}
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
  const { state, load } = useMemberView(clan.clan_tag);
  const d = state.data;
  const base = clanPath(clan.clan_tag);
  const y = d?.you;
  const away = `${base}/members/away`;
  const head = (
    <>
      <Link to={`${base}/members`} navigate={navigate}>
        ‹ Back to Members
      </Link>
      <div className="mt-3">
        <PageHead
          title={
            y ? (
              <>
                {y.name ?? <Tag tag={y.player_tag} />}{" "}
                <span className="chip chip--info align-middle">you</span>
              </>
            ) : (
              "Your record here"
            )
          }
          lede={
            y
              ? `${ROLE[y.role] ?? y.role} · ${n(y.trophies)} trophies · only you see this page`
              : undefined
          }
          fresh={
            d?.as_of ? (
              <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
            ) : null
          }
        >
          {d?.clan ? (
            <Link to={away} navigate={navigate} className="btn btn--sm w-fit">
              Away
            </Link>
          ) : null}
        </PageHead>
      </div>
    </>
  );
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Your current clan access does not allow this record.</span>
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        <ErrorState
          title={
            state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet"
              : state.error === "not_on_roster"
                ? "You are not on this clan’s roster yet"
                : "Your record could not be read just now"
          }
          onRetry={
            state.error === "clan_not_recorded" ||
            state.error === "not_on_roster"
              ? undefined
              : () => load()
          }
          busy={state.loading}
        >
          {state.error === "not_on_roster"
            ? "Elixir's record does not show you on this clan's roster yet."
            : state.error === "clan_not_recorded"
              ? null
              : "Try again in a moment."}
        </ErrorState>
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
  const s = c?.status ? statusChip(c.status) : null;
  const war = y.this_war_week;
  const weeks = [...y.weeks].reverse();
  const races = y.war_weeks;
  const closed = races.slice(-CHART).filter((w) => !w.open);
  const played = closed.reduce((k, w) => k + (w.decks ?? 0), 0);
  const asked = closed.every((w) => w.decks !== null && w.decks_asked !== null)
    ? closed.reduce((k, w) => k + w.decks_asked, 0)
    : null;
  const elder = `${base}/standings`;
  return (
    <>
      {head}

      {d.open_actions ? (
        <Panel
          as={Link}
          to={`${base}/feed`}
          navigate={navigate}
          className="flex items-center gap-3 px-4 py-3.5 mb-[22px] text-ink no-underline hover:bg-panel-raised"
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
        </Panel>
      ) : null}

      <h3 className="label mt-0 mb-2.5">This week so far</h3>
      <Tiles label="This week so far">
        {war ? (
          <Tile
            label="War decks"
            value={n(war.decks)}
            hint={
              counted("war") === false
                ? "Not counted here"
                : `${race(war)}, so far`
            }
          />
        ) : null}
        <Tile
          label="Path of Legends battles"
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
          <Panel aria-labelledby="you-doing">
            <Head id="you-doing" title="How you are doing here">
              {s ? <span className={`chip ${s[1]}`}>{s[0]}</span> : null}
            </Head>
            <div className="panel__body">
              <HowYouAreDoing d={d} base={base} navigate={navigate} />
            </div>
            {c ? (
              <div className="panel__foot">
                <Link to={elder} navigate={navigate}>
                  How it works here
                </Link>
              </div>
            ) : null}
          </Panel>

          {races.length ? (
            <Panel aria-labelledby="you-war">
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
              <Table
                columns={[
                  {
                    head: "Race",
                    cell: (w) => (
                      <>
                        {race(w)}
                        {w.is_colosseum ? " · Colosseum" : ""}
                        {w.open ? " (so far)" : ""}
                      </>
                    ),
                  },
                  {
                    head: "Decks played",
                    num: true,
                    cell: (w) => (
                      <>
                        {n(w.decks)}
                        {w.open || w.decks_asked == null
                          ? ""
                          : ` of ${w.decks_asked}`}
                      </>
                    ),
                  },
                  { head: "Points", num: true, cell: (w) => n(w.points) },
                ]}
                rows={[...races].reverse()}
                rowKey={(w) => race(w)}
              />
            </Panel>
          ) : null}

          <Panel aria-labelledby="you-weeks">
            <Head id="you-weeks" title="Week by week" />
            <p className="page-head__note px-4">
              A gap is unknown. Zero battles here does not prove no play.
            </p>
            <Table
              columns={[
                {
                  head: "Week of",
                  cell: (w) => (
                    <>
                      {w.complete
                        ? `Week of ${date(w.from)}`
                        : "This week so far"}
                      {Date.parse(w.from) <
                      Date.parse(y.time_here.recording_since) ? (
                        <span className="block page-head__note">
                          {Date.parse(w.to) <=
                          Date.parse(y.time_here.recording_since)
                            ? "Before roster recording"
                            : "Roster recording began during this week"}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                {
                  head: "Battles",
                  num: true,
                  cell: (w) => n(w.battles),
                },
                {
                  head: "Path of Legends",
                  num: true,
                  cell: (w) => n(w.ranked_battles),
                },
                { head: "Donations", num: true, cell: (w) => n(w.donations) },
              ]}
              rows={weeks}
              rowKey={(w) => w.from}
            />
          </Panel>
        </div>

        <div className="grid gap-4 min-w-0">
          <Panel aria-labelledby="you-time">
            <Head id="you-time" title="Your time here" />
            <div className="panel__body grid gap-2">
              <p className="m-0">
                {y.time_here.tenure_known && y.time_here.joined_observed_at
                  ? `Joined ${date(y.time_here.joined_observed_at)}: ${y.time_here.days} ${noun(y.time_here.days, "day")}.`
                  : `Here since before the record began (${date(y.time_here.recording_since)}): at least ${y.time_here.days ?? "?"} ${noun(y.time_here.days, "day")}.`}
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
          </Panel>

          {d.trophies.length ? (
            <Panel aria-labelledby="you-trophies">
              <Head id="you-trophies" title="Your awards here" />
              <ul className="m-0 p-0 list-none">
                {d.trophies.map((g) => (
                  <li
                    key={`${g.season_id}-${g.award_id}`}
                    className="flex items-center gap-2.5 px-4 py-2.5"
                  >
                    <span className="text-accent-bright">
                      <Icon name="award" size={16} />
                    </span>
                    <span className="grow">
                      {g.name}
                      {g.manual ? "" : ` · ${ordinal(g.rank)}`}
                    </span>
                    <span className="text-[12.5px] text-ink-faint">
                      Season {g.season_id}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
