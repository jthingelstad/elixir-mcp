import { Empty, Icon, Link, Panel, useClock } from "@elixir-mcp/ui";
import { useMemo, useState } from "react";
import { OTHER, clockTime, fmt, modeWords, readModes } from "./ladder.js";
import {
  battleDays,
  battleKind,
  battleOutcome,
  battlePath,
  battleWho,
  soloSittingLine,
  tallyLine,
  timeSpan,
  weekdayLabel,
} from "./ladder-days.js";
import { useBattleSweep } from "../lib/queries.js";
import { Loading, ReadError } from "./common.jsx";

/** Days a page lists before "Show older days". */
const DAYS_SHOWN = 7;
/** Sittings a day lists before "Show all". */
const SITTINGS_SHOWN = 5;

/**
 * The Battles tab: every battle in this chip's mode, by day and by sitting, each
 * opening on its own page. A war battle is listed like any other: Ladder shows a
 * person's battles one by one, and war by the week is the clan war's rule, which
 * the line above holds. Other is Challenge and Tournament, each a game of its
 * own: its own read, days and sittings, so no count or record crosses the two.
 */
export function Battles({ player, mode, modeReady, season, startsAt }) {
  return (
    <>
      {readModes(mode).map((group) => (
        <ModeBattles
          key={group}
          player={player}
          group={group}
          titled={mode === OTHER.key}
          modeReady={modeReady}
          season={season}
          startsAt={startsAt}
        />
      ))}
      {mode === OTHER.key ? <SittingFoot mode={mode} /> : null}
    </>
  );
}

function SittingFoot({ mode }) {
  return (
    <p className="footnote">
      A sitting is a run of battles with no gap longer than 30 minutes, and a
      day with two or more lists each one. A battle with a page opens on it,
      with both decks, and you can share why it mattered to you.
      {mode === "war"
        ? " War battles are listed one by one, like any other. Decks and points above are the clan war week."
        : ""}
      {mode === OTHER.key
        ? " A Tournament is not a Challenge, so the two are never added up."
        : ""}
    </p>
  );
}

/** One mode's days. `titled` heads them with the mode, where a chip holds two. */
function ModeBattles({ player, group, titled, modeReady, season, startsAt }) {
  const { zone, when } = useClock();
  const sweep = useBattleSweep(
    {
      player_tag: player.player_tag,
      season: season.arg,
      verbosity: "compact",
      limit: 40,
      mode: group,
    },
    { enabled: modeReady },
  );
  const battles = sweep.data?.battles;
  const days = useMemo(() => battleDays(battles ?? [], zone), [battles, zone]);
  const [older, setOlder] = useState(false);
  const words = modeWords(group);
  const title = titled ? <h2 className="ladder-group">{words}</h2> : null;
  if (!modeReady || sweep.isPending)
    return <Loading what={`the season's ${words} battles`} />;
  if (sweep.isError)
    return <ReadError error={sweep.error} what={`your ${words} battles`} />;
  if (!days.length)
    return (
      <Empty
        titleAs="h2"
        title={
          season.current
            ? `No ${words} battles recorded this season yet`
            : `No ${words} battles recorded in ${season.name}`
        }
      >
        {season.current
          ? `Elixir has recorded none in this mode since the season began${startsAt ? ` on ${when(startsAt)}` : ""}. Each mode keeps its own record; the others are a chip away.`
          : `Elixir recorded none in this mode in ${season.name}.`}
      </Empty>
    );
  const shown = older ? days : days.slice(0, DAYS_SHOWN);
  return (
    <>
      {title}
      {sweep.data?.capped ? (
        <div className="callout callout--info" role="status">
          <Icon name="info" size={17} />
          <span>
            This page reads the newest {fmt(sweep.data.battles.length)} of{" "}
            {fmt(sweep.data.total)} {titled ? `${words} ` : ""}battles, so
            anything older is not listed here. It is not a claim that there were
            none.
          </span>
        </div>
      ) : null}
      {shown.map((day) => (
        <Day
          key={day.ymd}
          day={day}
          past={!season.current}
          zone={zone}
          titleAs={titled ? "h3" : "h2"}
        />
      ))}
      {days.length > DAYS_SHOWN ? (
        <div>
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-expanded={older}
            onClick={() => setOlder((v) => !v)}
          >
            {older ? `Show the newest ${DAYS_SHOWN} days` : "Show older days"}
          </button>
        </div>
      ) : null}
      {titled ? null : <SittingFoot mode={group} />}
    </>
  );
}

function Day({ day, past, zone, titleAs }) {
  const [all, setAll] = useState(false);
  const sittings = all ? day.sittings : day.sittings.slice(0, SITTINGS_SHOWN);
  // One sitting has nothing to tell apart: the day's head says it and the
  // battles follow. A sitting row earns its place from the second on.
  if (day.sittings.length === 1)
    return (
      <Panel
        title={day.label}
        titleAs={titleAs}
        action={
          <span className="ladder-aside">{soloSittingLine(day, zone)}</span>
        }
      >
        <BattleRows battles={day.sittings[0].battles} zone={zone} />
      </Panel>
    );
  return (
    <Panel
      title={day.label}
      titleAs={titleAs}
      action={<span className="ladder-aside">{tallyLine(day)}</span>}
    >
      {sittings.map((s, i) => (
        <details key={s.key} className="ladder-sit" open={i === 0}>
          <summary>
            <span className="ladder-sit__when">
              {past ? `${weekdayLabel(s.day)}, ` : ""}
              {timeSpan(s.start, s.end, zone)}
            </span>
            <span className="ladder-sit__what">
              {tallyLine(sittingTally(s))}
              {s.trophies
                ? ` · ${fmt(s.trophies.from)} to ${fmt(s.trophies.to)}`
                : ""}
            </span>
          </summary>
          <BattleRows battles={s.battles} zone={zone} />
        </details>
      ))}
      {day.sittings.length > SITTINGS_SHOWN ? (
        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all
              ? `Show the newest ${SITTINGS_SHOWN}`
              : `Show all ${fmt(day.sittings.length)} sittings`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

const sittingTally = (s) =>
  s.modes.reduce(
    (t, m) => ({
      battles: t.battles + m.battles,
      wins: t.wins + m.wins,
      losses: t.losses + m.losses,
      draws: t.draws + m.draws,
    }),
    { battles: 0, wins: 0, losses: 0, draws: 0 },
  );

function BattleRows({ battles, zone }) {
  return (
    <ul className="ladder-rows">
      {battles.map((b) => (
        <BattleRow key={b.battle_id ?? b.battle_time} b={b} zone={zone} />
      ))}
    </ul>
  );
}

/** One battle: when, how it went, against whom, and the trophies it moved. The
 *  result sits by the time in Record's colours, so the list reads down one
 *  column. A battle with no change shows none: on the floor a loss costs
 *  nothing. */
function BattleRow({ b, zone }) {
  const who = battleWho(b);
  const path = battlePath(b.url);
  const change = b.me?.trophy_change;
  const kind = battleKind(b);
  const outcome = battleOutcome(b);
  return (
    <li className="ladder-row">
      <span className="ladder-row__t">{clockTime(b.battle_time, zone)}</span>
      <span className={`ladder-row__res ladder-row__res--${outcome.tone}`}>
        {outcome.words}
      </span>
      <span className="ladder-row__who">
        {path ? <Link to={path}>{who}</Link> : who}
        {kind ? <span className="ladder-row__kind"> {kind}</span> : null}
      </span>
      <span className="ladder-row__tr">
        {change ? `${change > 0 ? "+" : "−"}${fmt(Math.abs(change))}` : ""}
      </span>
    </li>
  );
}
