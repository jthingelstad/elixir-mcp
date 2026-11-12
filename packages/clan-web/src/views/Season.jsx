import { CATEGORY_LABELS } from "@elixir-mcp/clan-engine";
import { Panel, Table, Tag, TagText, useClock } from "@elixir-mcp/ui";
import { useEffect, useState } from "react";
import { MemberLink } from "../components/MemberLink.jsx";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { useSeason, useWeek } from "../lib/queries.js";
import {
  ROLE,
  date,
  n,
  ordinal,
  plural,
  seasonWeek,
  trophyChange,
} from "../lib/words.js";

const STATUS = {
  open: "So far",
  closed: "Closed",
  unconfirmed: "Closure unconfirmed",
  missing: "Not in this read",
  upcoming: "Upcoming",
};
const DAY_MS = 86_400_000;
/** The members the war list opens with. */
const TOP = 5;
const ISO = /^\d{4}-w\d{1,2}$/i;
/** A season's week by its number, `136-2`: never an ISO week (`2026-w40`). */
const SEASON_WEEK = /^(\d{1,5})-(\d{1,2})$/;
const after = (a, b) => Date.parse(a ?? "") > Date.parse(b ?? "");
const list = (items) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** When the first whole week Elixir records for a clan closes: the Monday
 *  reset ending the first week that began after it started following the
 *  clan. */
function firstFullWeekCloses(recordedFrom) {
  const t = Date.parse(recordedFrom ?? "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  let monday = midnight + ((8 - d.getUTCDay()) % 7) * DAY_MS;
  if (monday < t) monday += 7 * DAY_MS;
  return new Date(monday + 7 * DAY_MS).toISOString();
}

/** Why the week's highlighted areas are highlighted, in the clan's terms. */
function basisLine(highlight, policy) {
  if (highlight?.basis === "policy")
    return `Highlighted: what this clan counts (${list(
      highlight.counted.map((k) =>
        k === "battles"
          ? "Trophy road, shown as battles played"
          : (CATEGORY_LABELS[k] ?? k),
      ),
    )}).`;
  if (policy?.active)
    return "This clan's policy counts no category, so the week highlights where the clan was busiest.";
  if (policy?.set)
    return "Clan management is paused below 10 members, so the week highlights where the clan was busiest.";
  return "This clan's leaders have not set up how it runs yet, so the week highlights where the clan was busiest.";
}

/** The picker: the running week, then each race in the read and each season's
 *  whole, newest first. A week's address is its ISO week when the read holds
 *  one, so a race only the season read knows has no week page and is not
 *  offered (it stays a row of its season). */
function periodOptions(weekRead, seasonRead) {
  const weeks = weekRead?.weeks ?? [];
  const seasons = seasonRead?.seasons ?? [];
  const raceOf = (from) => {
    const t = Date.parse(from);
    for (const s of seasons)
      for (const r of s.races)
        if (Date.parse(r.from) <= t + DAY_MS && t < Date.parse(r.to) - DAY_MS)
          return { season_id: s.season_id, ...r };
    return null;
  };
  const options = [];
  const running = weekRead?.so_far;
  if (running?.iso_week) {
    const war = running.areas?.find((a) => a.key === "war")?.war;
    options.push({
      value: String(running.iso_week).toLowerCase(),
      label: `${seasonWeek(war) ?? `The week of ${date(running.from)}`}, so far`,
    });
  }
  for (const w of weeks) {
    const race = raceOf(w.from);
    options.push({
      value: String(w.iso_week).toLowerCase(),
      label: race
        ? `${seasonWeek(race)}${race.is_colosseum ? ", Colosseum" : ""}`
        : `The week of ${date(w.from)}`,
    });
  }
  for (const s of seasons)
    options.push({
      value: String(s.season_id),
      label: `All of Season ${s.season_id}${
        s.season_id === seasonRead.current_season_id
          ? ", so far"
          : s.coverage?.before_window
            ? ", part of the record"
            : ""
      }`,
    });
  return options;
}

/** The week page a season's race opens on: the ISO week of the week read
 *  that the race falls in, or null when the read holds no such week. One
 *  week of a season by its number (`/war/<season>-<n>`) is the address
 *  mail and Discord write, since they know the race and not the
 *  ISO week (2026-11-12). */
export function raceWeekPage(weekRead, seasonRead, seasonId, weekNumber) {
  const index = Number(weekNumber) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  const season = (seasonRead?.seasons ?? []).find(
    (s) => String(s.season_id) === String(seasonId),
  );
  const race = season?.races?.find((r) => r.section_index === index);
  if (!race?.from || !race?.to) return null;
  const weeks = [weekRead?.so_far, ...(weekRead?.weeks ?? [])].filter(
    (w) => w?.iso_week && w.from,
  );
  const week = weeks.find((w) => {
    const t = Date.parse(w.from);
    return (
      Date.parse(race.from) <= t + DAY_MS && t < Date.parse(race.to) - DAY_MS
    );
  });
  return week ? String(week.iso_week).toLowerCase() : null;
}

/** The one war list: who played decks and scored points, top five first. */
function WarList({ area, clan, navigate }) {
  const [all, setAll] = useState(false);
  const rows = area.participants ?? [];
  const asked = area.war?.decks_asked;
  const shown = all ? rows : rows.slice(0, TOP);
  return (
    <Panel aria-labelledby="season-war">
      <div className="panel__head">
        <h3 id="season-war" className="m-0 grow text-[14px] font-semibold">
          War decks and points
        </h3>
      </div>
      <Table
        labelledBy="season-war"
        rowKey={(p) => p.player_tag}
        rows={shown}
        columns={[
          {
            head: "Member",
            rowHeader: true,
            cell: (p) => (
              <>
                <MemberLink
                  clanTag={clan.clan_tag}
                  playerTag={p.player_tag}
                  navigate={navigate}
                >
                  {p.name ?? <Tag tag={p.player_tag} />}
                </MemberLink>
                {p.joined_during ? (
                  <span className="ml-2 text-[12px] text-ink-faint">new</span>
                ) : null}
              </>
            ),
          },
          {
            head: "War decks",
            num: true,
            cell: (p) => (asked ? `${n(p.value)} of ${asked}` : n(p.value)),
          },
          { head: "Points", num: true, cell: (p) => n(p.points) },
        ]}
      />
      {rows.length > TOP ? (
        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

/** Who came and went inside the week, each with their time. A departure says
 *  "departed": this page reaches every member and never knows more. */
function Membership({ m }) {
  const { when } = useClock();
  const name = (x) => x.name ?? x.player_tag;
  const rows = [
    ...m.joined.map((x) => [x, `${name(x)} joined`]),
    ...m.departed.map((x) => [x, `${name(x)} departed`]),
    ...m.promoted.map((x) => [
      x,
      `${name(x)} moved up to ${ROLE[x.role_after] ?? x.role_after}`,
    ]),
    ...m.demoted.map((x) => [
      x,
      `${name(x)} moved to ${ROLE[x.role_after] ?? x.role_after}`,
    ]),
  ];
  return (
    <details className="disclosure">
      <summary>
        Who came and went{rows.length ? ` · ${rows.length}` : ""}
      </summary>
      <div className="disclosure__body grid gap-1.5">
        {rows.map(([x, line]) => (
          <p
            key={line}
            className="m-0 flex justify-between gap-3 text-[13.5px]"
          >
            <TagText>{line}</TagText>
            {x.at ? (
              <span className="shrink-0 text-ink-faint">{when(x.at)}</span>
            ) : null}
          </p>
        ))}
        {rows.length === 0 && m.complete ? (
          <p className="page-head__note m-0">
            Nobody joined, departed or changed role.
          </p>
        ) : null}
        {!m.complete ? (
          <p className="page-head__note m-0">
            Elixir&rsquo;s recent roster events
            {m.events_from
              ? ` reach back to ${date(m.events_from)}`
              : " do not cover this week"}
            ; earlier changes are not shown.
          </p>
        ) : null}
      </div>
    </details>
  );
}

const WEEK_NOTE =
  "Battles and Path of Legends are this clan's recorded battles, including members who have since departed. Donations and war decks are for today's members: someone who has departed is not counted there, though All of Season counts them. Only those who took part are named.";

/** The areas other than the race: donations, then ranked play and battles. */
function OtherAreas({ areas }) {
  const by = (k) => areas.find((a) => a.key === k);
  const took = (a) => a.took_part ?? a.participants.length;
  const donations = by("donations");
  const ranked = by("ranked");
  const battles = by("battles");
  return (
    <>
      {donations ? (
        <Panel as="div" title="Donations" titleAs="h3">
          <p className="panel__body m-0">
            {plural(donations.total, "card")} donated by{" "}
            {plural(took(donations), "member")}.
          </p>
        </Panel>
      ) : null}
      {ranked || battles ? (
        <Panel as="div" title="Path of Legends and battles" titleAs="h3">
          <div className="panel__body grid gap-1">
            {battles ? (
              <p className="m-0">
                {plural(battles.total, "battle")} by{" "}
                {plural(took(battles), "member")}.
              </p>
            ) : null}
            {ranked ? (
              <p className="m-0">
                {plural(ranked.total, "Path of Legends battle")} by{" "}
                {plural(took(ranked), "member")}.
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/** The week still running. Decks count up until the clan finishes or the
 *  week closes, so no "of N" reads as a result. */
function OpenWeek({ s, policy, recordedFrom, clan, navigate }) {
  const war = s.areas.find((a) => a.key === "war");
  const donations = s.areas.find((a) => a.key === "donations");
  const quiet = s.areas.every((a) => !a.total);
  return (
    <>
      <PageHead
        title={
          <>
            {seasonWeek(war?.war) ?? `The week of ${date(s.from)}`}, so far{" "}
            <span className="chip chip--info align-middle">
              {war?.war?.is_colosseum ? "Colosseum" : "Race open"}
            </span>
          </>
        }
        lede={`Began ${date(s.from)}. ${basisLine(s.highlight, policy)}`}
      />
      {after(recordedFrom, s.from) ? (
        <p className="page-head__note">
          Counted from {date(recordedFrom)}, when Elixir started following this
          clan.
        </p>
      ) : null}
      {quiet ? (
        <div className="callout" role="note">
          <span>
            <b>
              {s.highlight?.basis === "policy"
                ? "Nothing the clan counts was recorded this week"
                : "No member took part in anything Elixir recorded this week"}
            </b>
            . A gap is unknown.
          </span>
        </div>
      ) : (
        <>
          <Tiles label="This week so far">
            {war ? (
              <Tile
                label="War decks so far"
                value={n(war.total)}
                hint={`by ${plural(war.took_part, "member")}`}
              />
            ) : null}
            {war?.points !== null && war?.points !== undefined ? (
              <Tile
                label="Points so far"
                value={n(war.points)}
                hint="Member contributions"
              />
            ) : null}
            {donations ? (
              <Tile
                label="Donations so far"
                value={n(donations.total)}
                hint={`by ${plural(donations.took_part, "member")}`}
              />
            ) : null}
          </Tiles>
          {war ? (
            <p className="page-head__note">
              The race is still open, so decks count up until the clan finishes
              or the week closes.
            </p>
          ) : null}
          <div className="grid gap-4">
            {war?.participants?.length ? (
              <WarList area={war} clan={clan} navigate={navigate} />
            ) : null}
            <OtherAreas areas={s.areas} />
          </div>
        </>
      )}
      <div className="mt-4 grid gap-4">
        <Membership m={s.membership} />
        <p className="page-head__note m-0">{WEEK_NOTE}</p>
      </div>
    </>
  );
}

/** A week that closed: the race's result, then what the clan did together. */
function ClosedWeek({ d, clan, navigate }) {
  const war = d.areas.find((a) => a.key === "war");
  const w = war?.war;
  const asked = w?.decks_asked;
  const r = w?.result;
  const earlyClose =
    w?.finished_early && Date.parse(d.week.closed_at) < Date.parse(d.week.to);
  const closes = earlyClose
    ? `it closed ${date(d.week.closed_at)}, when the clan finished.`
    : `closed at the Monday reset on ${date(d.week.closed_at ?? d.week.to)}.`;
  const before = after(d.recorded_from, d.week.from);
  const first = before ? firstFullWeekCloses(d.recorded_from) : null;
  const quiet = !d.areas.some((a) => a.highlighted);
  const fact = w?.is_colosseum
    ? `Colosseum week: all four war days count.${asked ? ` Decks asked: ${asked} each.` : ""}`
    : w?.finished_early && w.finish_war_day
      ? `The boat crossed the finish line on war day ${w.finish_war_day}.${asked ? ` Decks asked: ${asked} each.` : ""}`
      : asked
        ? `Decks asked: ${asked} each.`
        : null;
  return (
    <>
      <PageHead
        title={
          <>
            {seasonWeek(w) ?? `The week of ${date(d.week.from)}`}{" "}
            {w?.is_colosseum ? (
              <span className="chip chip--info align-middle">Colosseum</span>
            ) : (
              <span className="chip chip--mute align-middle">Closed</span>
            )}
          </>
        }
        lede={`The week of ${date(d.week.from)}: ${closes} ${basisLine(d.highlight, d.policy)}`}
      />
      {before ? (
        <div className="callout" role="note">
          <span>
            <b>Before Elixir followed this clan.</b> Elixir started following
            this clan on {date(d.recorded_from)}, after this week began, so it
            holds no record of the week.
            {first
              ? ` The first full week it records closes at the Monday reset on ${date(first)}.`
              : ""}
          </span>
        </div>
      ) : quiet ? (
        <div className="callout" role="note">
          <span>
            <b>
              {d.highlight.basis === "policy"
                ? "Nothing the clan counts was recorded this week"
                : "No member took part in anything Elixir recorded this week"}
            </b>
            . A gap is unknown.
          </span>
        </div>
      ) : null}
      {r?.rank ? (
        <Panel as="div" className="mb-4">
          <div className="panel__body grid gap-1">
            <span className="label">Race result</span>
            <span className="text-[18px] font-semibold">
              {ordinal(r.rank)}
              {r.fame !== null ? ` · ${n(r.fame)} fame` : ""}
            </span>
            {trophyChange(r) ? (
              <span className="text-ink-dim">
                {trophyChange(r)}
                {r.clan_war_trophies !== null
                  ? `, to ${n(r.clan_war_trophies)}`
                  : ""}
              </span>
            ) : null}
          </div>
        </Panel>
      ) : null}
      {fact ? <p className="page-head__note">{fact}</p> : null}
      {war ? (
        <Tiles label="The week in numbers">
          <Tile
            label="Took part"
            value={n(war.participants.length)}
            of={`of ${n(d.members)}`}
            hint="Played a war deck"
          />
          {asked ? (
            <Tile
              label="Every deck asked"
              value={n(w.all_decks)}
              tone="ok"
              hint={`${asked} decks each`}
            />
          ) : null}
          {asked ? (
            <Tile
              label="Partway"
              value={n(war.participants.length - w.all_decks)}
              tone="warn"
              hint={`Fewer than the ${asked} decks asked`}
            />
          ) : null}
        </Tiles>
      ) : null}
      {war ? (
        <p className="page-head__note">
          Fame belongs to the boat, the clan&rsquo;s total in the race. Points
          belong to each member.
        </p>
      ) : null}
      <div className="grid gap-4">
        {war?.participants?.length ? (
          <WarList area={war} clan={clan} navigate={navigate} />
        ) : null}
        <OtherAreas areas={d.areas} />
        <Membership m={d.membership} />
        <p className="page-head__note m-0">{WEEK_NOTE}</p>
      </div>
    </>
  );
}

/** A whole season: the record's totals and each race. */
function WholeSeason({ s, current }) {
  const c = s.coverage;
  return (
    <>
      <PageHead
        title={
          <>
            All of Season {s.season_id}
            {s.season_id === current ? ", so far" : ""}{" "}
            <span className="chip chip--mute align-middle">
              {c.before_window ? "Part of the record" : STATUS[s.state]}
            </span>
          </>
        }
        lede={`${date(s.from)} to ${date(s.to)}. Clan Wars totals and each race in this season.`}
      />
      <Tiles label="Season totals">
        <Tile
          label="War decks"
          value={n(s.decks)}
          hint="What the record holds"
        />
        <Tile label="Points" value={n(s.points)} hint="Member contributions" />
        <Tile
          label="Took part"
          value={n(s.contributors)}
          hint="Each player counted once"
        />
      </Tiles>
      <Panel>
        <div className="panel__head">
          <h3 id="season-races" className="m-0 grow text-[14px] font-semibold">
            Race by race
          </h3>
          <span className="page-head__note font-normal">
            {c.recorded_sections} of {c.expected_sections} races recorded
          </span>
        </div>
        <div className="clan-rows">
          <Table
            labelledBy="season-races"
            caption="War decks, points and who took part, in the order the races ran"
            rowKey={(r) => r.section_index}
            rows={s.races}
            columns={[
              {
                head: "Race",
                rowHeader: true,
                cell: (r) => (
                  <>
                    Week {r.section_index + 1}
                    {r.is_colosseum ? " · Colosseum" : ""}
                    <span className="block text-[12px] text-ink-faint">
                      {date(r.from)}
                    </span>
                  </>
                ),
              },
              {
                head: "State",
                cellProps: () => ({ "data-label": "State" }),
                cell: (r) => (
                  <>
                    {STATUS[r.state]}
                    {r.counters_unknown ? (
                      <span className="block text-[12px] text-ink-faint">
                        Partial readings
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                head: "Result",
                cellProps: () => ({ "data-label": "Result" }),
                cell: (r) =>
                  r.result?.rank ? (
                    <>
                      {ordinal(r.result.rank)}
                      {r.result.fame !== null
                        ? ` · ${n(r.result.fame)} fame`
                        : ""}
                    </>
                  ) : (
                    <span className="nil">—</span>
                  ),
              },
              {
                head: "War decks",
                num: true,
                cellProps: () => ({ "data-label": "War decks" }),
                cell: (r) => n(r.decks),
              },
              {
                head: "Points",
                num: true,
                cellProps: () => ({ "data-label": "Points" }),
                cell: (r) => n(r.points),
              },
              {
                head: "Took part",
                num: true,
                cellProps: () => ({ "data-label": "Took part" }),
                cell: (r) => n(r.contributors),
              },
            ]}
          />
        </div>
        <div className="panel__foot grid gap-2">
          <p className="m-0">
            Readings from {c.current_members} current and {c.former_members}{" "}
            former members. A gap is unknown.
          </p>
          {c.missing_sections ? (
            <p className="m-0">
              {c.missing_sections} race
              {c.missing_sections === 1 ? " has" : "s have"} no reading yet.
            </p>
          ) : null}
          {c.before_window ? (
            <p className="m-0">
              This season begins before the eight-week read. Earlier
              contributions are outside these totals.
            </p>
          ) : null}
          {c.roster_started_late ? (
            <p className="m-0">
              Roster recording began after this season started.
            </p>
          ) : null}
          {c.closure_unconfirmed ? (
            <p className="m-0">
              Some past race closures are not confirmed in the record.
            </p>
          ) : null}
          <p className="m-0">
            These are the members Elixir read, not every contribution to the
            clan.
          </p>
        </div>
      </Panel>
    </>
  );
}

/**
 * War (Season until Clan became one view, 2026-11-12): the week and the
 * season on one tab, behind one picker (structure.md, A14). `/war` is the
 * running week or, if none runs, the latest to close; `/war/<iso week>` a
 * week; `/war/<number>` all of a season, and `/war/<number>-<n>` that
 * season's nth week, which opens its week page when the read holds it and
 * otherwise shows the season. Weekly totals only. Every member
 * reads it, whatever the clan's policy; it raises no action and holds no
 * standing.
 */
export function Season({ clan, period, navigate }) {
  const base = `${clanPath(clan.clan_tag)}/war`;
  const iso = period && ISO.test(period) ? period : null;
  // `<season>-<n>`: that season's nth week, as mail and Discord name it.
  const seasonWeekAsked = period ? SEASON_WEEK.exec(period) : null;
  const seasonId =
    period && /^\d{1,5}$/.test(period)
      ? period
      : (seasonWeekAsked?.[1] ?? null);
  const week = seasonWeekAsked?.[2] ?? null;
  const latest = useWeek(clan.clan_tag, null);
  const asked = useWeek(clan.clan_tag, iso, { enabled: Boolean(iso) });
  const season = useSeason(clan.clan_tag);
  const running = latest.state.data?.so_far;
  const runningIso = running?.iso_week
    ? String(running.iso_week).toLowerCase()
    : null;
  const viewsRunning = !period || (iso && iso.toLowerCase() === runningIso);
  const read = iso && !viewsRunning ? asked.state : latest.state;
  const d = read.data;
  const data = latest.state.data;
  const seasonData = season.state.data;
  // One week of a season, by its number: its week page once both reads
  // can place it; otherwise the season stays, with the week as one of its
  // rows.
  const weekPage =
    seasonId && week != null
      ? raceWeekPage(data, seasonData, seasonId, week)
      : null;
  useEffect(() => {
    if (weekPage) navigate?.(`${base}/${weekPage}`, { replace: true });
  }, [weekPage, base, navigate]);
  if (read.signedOut || season.state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const options = periodOptions(data, seasonData);
  const current =
    (seasonWeekAsked ? seasonId : period) ??
    runningIso ??
    (data?.week ? String(data.week.iso_week).toLowerCase() : "");
  const picker = options.length ? (
    <div className="clan-subnav">
      <label className="flex items-center gap-3">
        <span className="field-label">Period</span>
        <select
          className="input w-auto"
          value={options.some((o) => o.value === current) ? current : ""}
          onChange={(e) => navigate?.(`${base}/${e.target.value}`)}
        >
          {options.some((o) => o.value === current) ? null : (
            <option value="">Choose a period</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  ) : null;
  const say = (title, body, to, label) => (
    <>
      <h2 className="sr-only">Season</h2>
      {picker}
      <div className="callout callout--warn" role="alert">
        <span>
          <b>{title}.</b> {body}{" "}
          {to ? (
            <a
              href={to}
              onClick={(e) => {
                e.preventDefault();
                navigate?.(to);
              }}
            >
              {label}
            </a>
          ) : null}
        </span>
      </div>
    </>
  );
  const denied = (state) =>
    state.forbidden
      ? say("Not open to you", "Your current clan access does not allow this.")
      : state.error === "clan_not_recorded"
        ? say(
            "Elixir is not recording this clan yet",
            "The week starts with the first read.",
          )
        : state.error && state.error !== "no_week"
          ? say("Elixir did not answer", "Try again in a minute.")
          : null;
  if (seasonId) {
    const blocked = denied(season.state);
    if (blocked) return blocked;
    if (!seasonData) return <p className="page__lede">Reading the season…</p>;
    const s = seasonData.seasons.find((r) => String(r.season_id) === seasonId);
    if (!s)
      return say(
        "That period is outside this read of the record",
        "Elixir reads the last eight weeks here. Past awards stay in Awards.",
        base,
        "Current season",
      );
    return (
      <>
        {picker}
        <WholeSeason s={s} current={seasonData.current_season_id} />
      </>
    );
  }
  if (read.error === "no_week")
    return say(
      "That period is outside this read of the record",
      "Elixir reads the last eight weeks here. Past awards stay in Awards.",
      base,
      "Current season",
    );
  const blocked = denied(read);
  if (blocked) return blocked;
  if (!d) return <p className="page__lede">Reading the week…</p>;
  if (viewsRunning && running)
    return (
      <>
        {picker}
        <OpenWeek
          s={running}
          policy={d.policy}
          recordedFrom={d.recorded_from}
          clan={clan}
          navigate={navigate}
        />
      </>
    );
  if (!d.week)
    return say(
      "No week has closed in the record yet",
      "The first one closes at the Monday reset.",
    );
  return (
    <>
      {picker}
      <ClosedWeek d={d} clan={clan} navigate={navigate} />
    </>
  );
}
