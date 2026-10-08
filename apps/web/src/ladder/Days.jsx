import { Icon, Link, useClock } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import { clockTime, fmt, longDay, monthName, zoneShort } from "./ladder.js";
import {
  battlePath,
  battleScore,
  battleWho,
  daysPlayed,
  groupLabel,
  longestBreak,
  modeDays,
  nightLine,
  nightsOf,
  seasonCalendar,
  spanLabel,
  timeSpan,
  weekdayLabel,
  weekdayOf,
  zoneName,
} from "./ladder-days.js";
import { useBattleSweep, useToolRead } from "../lib/queries.js";
import { LadderHead, Loading, ReadError, Record, Tile } from "./common.jsx";

/** Nights a page lists before "Show every night". */
const NIGHTS_SHOWN = 5;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Days played (LadderDays.dc.html): every day of the season on the
 * account's calendar and every night, from the season's battles as
 * battles_query returns them (compact, every page through next_cursor up
 * to the sweep's cap). Forty compact rows fit the result cap with room;
 * a page that does not is read again at the limit the hub's refusal
 * names (lib/battle-sweep.js). Each mode keeps its own mark and its own
 * record; the page counts battles and never rates a day.
 */
export function Days({ player, summary }) {
  const { zone } = useClock();
  const [now] = useState(() => Date.now());
  const coverage = useToolRead("elixir_coverage", {
    player_tag: player.player_tag,
  });
  const sweep = useBattleSweep({
    player_tag: player.player_tag,
    season: "current",
    verbosity: "compact",
    limit: 40,
  });
  const first = sweep.data?.first;
  const season = first?.applied?.window?.season ?? null;
  const battles = sweep.data?.battles ?? [];
  const capped = Boolean(sweep.data?.capped);
  const cal = season
    ? seasonCalendar({
        battles,
        startsAt: season.starts_at,
        endsAt: season.ends_at,
        now,
        zone,
        readFrom: capped ? (battles.at(-1)?.battle_time ?? null) : null,
        observationIntervals: coverage.data?.observation_intervals ?? [],
      })
    : null;
  const so = cal ? daysPlayed(cal.days) : null;
  const name = season?.month ? `${monthName(season.month)} season` : "season";

  return (
    <div className="ladder-page">
      <LadderHead
        player={player}
        page="Days played"
        title={
          so ? `${fmt(so.played)} days with recorded battles` : "Days played"
        }
        lede={`Every day of the ${name}, ${zoneName(zone)}. Each mode keeps its own mark and its own record, so a war day and a Trophy Road night never add up to one number.`}
        observedAt={first?.meta?.source_polls?.player_battlelog?.observed_at}
      />
      {sweep.isPending ? (
        <Loading what="the season's battles" />
      ) : sweep.isError ? (
        <ReadError error={sweep.error} what="the season's battles" />
      ) : !cal ? (
        <ReadError what="the season's dates" />
      ) : (
        <DaysBody
          cal={cal}
          so={so}
          name={name}
          season={season}
          battles={battles}
          capped={capped}
          total={sweep.data.total}
          floor={summary.data?.trophy_floor?.floor ?? null}
          zone={zone}
          coverageError={coverage.isError}
        />
      )}
    </div>
  );
}

function DaysBody({
  cal,
  so,
  name,
  season,
  battles,
  capped,
  total,
  floor,
  zone,
  coverageError,
}) {
  const modes = modeDays(cal.days);
  const gap = longestBreak(cal.days);
  const firstRead = cal.days.find((d) => d.state !== "unread");
  return (
    <>
      <div className="ladder-tiles">
        <Tile
          label="Days with recorded battles"
          sub={`in ${fmt(so.of)} season days so far`}
        >
          {fmt(so.played)}
        </Tile>
        {modes.slice(0, 2).map((m) => (
          <Tile
            key={m.key}
            label={`${m.label} days`}
            sub={
              <>
                {fmt(m.battles)} {m.battles === 1 ? "battle" : "battles"},{" "}
                <Record wins={m.wins} losses={m.losses} draws={m.draws} />
              </>
            }
          >
            {fmt(m.days)}
          </Tile>
        ))}
        <Tile
          label="Longest covered quiet stretch"
          sub={gap ? spanLabel(gap) : "No fully covered quiet days"}
        >
          {gap
            ? `${fmt(gap.length)} ${gap.length === 1 ? "day" : "days"}`
            : "Unknown"}
        </Tile>
      </div>

      <div className="callout callout--info">
        <Icon name="info" size={17} />
        <span>
          {coverageError ? "Capture coverage could not be checked. " : ""}
          Recorded battles are evidence of play. Days without them stay unknown
          unless comparable, complete profile intervals cover the whole day.
          Gaps and the time since the latest observation are not quiet days.
        </span>
      </div>

      {capped ? (
        <div className="callout callout--info">
          <Icon name="info" size={17} />
          <span>
            This page reads the newest {fmt(battles.length)}
            {total != null ? ` of ${fmt(total)}` : ""} battles this season, so
            the days before {firstRead ? firstRead.label : "the newest"} are
            marked partially read rather than drawn empty; any battles already
            read remain visible.
          </span>
        </div>
      ) : null}

      <Calendar cal={cal} name={name} season={season} zone={zone} />
      <p className="footnote">
        Open a night and choose a captured battle to inspect it and share why it
        mattered to you.
      </p>
      <Nights battles={battles} floor={floor} zone={zone} />
    </>
  );
}

function Calendar({ cal, name, season, zone }) {
  const present = [
    ...new Map(
      cal.days.flatMap((d) => d.modes).map((m) => [m.key, m.label]),
    ).entries(),
  ];
  return (
    <section className="panel" aria-labelledby="ladder-cal">
      <div className="panel__head">
        <h2 id="ladder-cal" className="ladder-panel-title">
          {name[0].toUpperCase() + name.slice(1)}, day by day
        </h2>
        {present.map(([key, label]) => (
          <span key={key} className="ladder-key">
            <span
              className={`mode-chip__dot mode-chip__dot--${key}`}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
        <span className="ladder-key text-ink-faint">
          deeper shade, more battles
        </span>
      </div>
      <div className="panel__body">
        <div className="ladder-cal__weekdays" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <ol className="ladder-cal">
          {Array.from({ length: cal.lead }, (_, i) => (
            <li
              key={`blank-${i}`}
              className="ladder-day ladder-day--blank"
              aria-hidden="true"
            />
          ))}
          {cal.days.map((d) => (
            <Day key={d.ymd} day={d} />
          ))}
        </ol>
      </div>
      <div className="panel__foot">
        The season runs {longDay(season.starts_at, zone)} at{" "}
        {clockTime(season.starts_at, zone)} {zoneShort(season.starts_at, zone)}{" "}
        to {longDay(season.ends_at, zone)} at {clockTime(season.ends_at, zone)}{" "}
        {zoneShort(season.ends_at, zone)}. Battles after midnight count on the
        next day.
      </div>
    </section>
  );
}

function Day({ day }) {
  const counted = day.count > 0 || day.capture.quiet;
  const none =
    day.state === "future"
      ? "to come"
      : day.state === "unread"
        ? "partially read"
        : day.count === 0
          ? day.state === "today"
            ? "today · capture incomplete"
            : day.capture.quiet
              ? "no recorded battles · covered day"
              : day.capture.coverage === "partial"
                ? "capture incomplete"
                : "capture unknown"
          : null;
  return (
    <li
      className={`ladder-day ladder-day--l${day.level} ladder-day--${day.state}`}
      aria-current={day.state === "today" ? "date" : undefined}
    >
      <span className="ladder-day__head">
        <span className="ladder-day__date">
          {/* The wide grid's weekday is its column's, which a screen
              reader does not hear: the day names its own, shown on a
              phone where the calendar is a list. */}
          <span className="ladder-day__wd">{weekdayOf(day.ymd)} </span>
          {day.label}
        </span>
        {counted ? (
          <span
            className="ladder-day__n"
            aria-label={`${day.count} ${day.count === 1 ? "battle" : "battles"}`}
          >
            {day.count}
          </span>
        ) : null}
      </span>
      {day.modes.map((m) => (
        <span key={m.key} className="ladder-day__mode">
          <span
            className={`mode-chip__dot mode-chip__dot--${m.key}`}
            aria-hidden="true"
          />
          <span className="ladder-day__label">{m.label}</span>
          <Record wins={m.wins} losses={m.losses} draws={m.draws} />
        </span>
      ))}
      {none ? <span className="ladder-day__none">{none}</span> : null}
    </li>
  );
}

function Nights({ battles, floor, zone }) {
  const [all, setAll] = useState(false);
  const nights = nightsOf(battles, zone);
  const shown = all ? nights : nights.slice(0, NIGHTS_SHOWN);
  return (
    <section className="panel" aria-labelledby="ladder-nights">
      <div className="panel__head">
        <h2 id="ladder-nights" className="ladder-panel-title">
          Nights
        </h2>
        <span className="text-[12.5px] text-ink-faint">
          {fmt(nights.length)} this season, newest first
        </span>
      </div>
      {nights.length === 0 ? (
        <div className="panel__body">
          <p className="text-ink-faint">No battles recorded this season yet.</p>
        </div>
      ) : (
        <ul className="ladder-nights">
          {shown.map((n) => (
            <Night key={n.key} night={n} floor={floor} zone={zone} />
          ))}
        </ul>
      )}
      {nights.length > NIGHTS_SHOWN ? (
        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all
              ? `Show the newest ${NIGHTS_SHOWN}`
              : `Show all ${fmt(nights.length)} nights`}
          </button>
        </div>
      ) : null}
      <div className="panel__foot">
        A night is a run of battles with no gap longer than 30 minutes. Open one
        to see each battle; a battle with a page opens on it, with both decks.
      </div>
    </section>
  );
}

function Night({ night, floor, zone }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const single = night.modes.length === 1 ? night.modes[0] : null;
  const onFloor =
    floor != null && night.trophies != null && night.trophies.to === floor;
  return (
    <li className="ladder-night">
      <button
        type="button"
        className="ladder-night__head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ladder-night__when">
          <span className="ladder-night__day">{weekdayLabel(night.day)}</span>
          <span className="ladder-night__time">
            {timeSpan(night.start, night.end, zone)}{" "}
            {zoneShort(night.start, zone)}
          </span>
        </span>
        <span className="ladder-night__what">
          {single ? (
            <span>{nightLine(night.sequence)}</span>
          ) : (
            <span>
              {night.sequence.map((s, i) => (
                <span key={`${s.key}-${i}`} className="ladder-night__seg">
                  {i ? ", then " : ""}
                  {nightLine([s])}
                  <Record wins={s.wins} losses={s.losses} draws={s.draws} />
                </span>
              ))}
            </span>
          )}
          {onFloor ? (
            <span className="ladder-night__sub">
              Ended on the {fmt(floor)} floor
            </span>
          ) : null}
        </span>
        <span className="ladder-night__record">
          {single ? (
            <Record
              wins={single.wins}
              losses={single.losses}
              draws={single.draws}
            />
          ) : null}
        </span>
        <span className="ladder-night__trophies">
          {night.trophies
            ? `${fmt(night.trophies.from)} → ${fmt(night.trophies.to)}`
            : ""}
        </span>
        <span className="ladder-night__chev">
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {open ? (
        <ul id={id} className="battle-rows ladder-night__battles">
          {night.battles.map((b) => (
            <BattleRow
              key={b.battle_id ?? b.battle_time}
              battle={b}
              zone={zone}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One battle of a night, newest first: when, the mode's mark, who, and
 *  the score. It links to the battle's own page only when the tool
 *  returned that page's url. */
function BattleRow({ battle, zone }) {
  const o = battle.me?.outcome;
  const tone =
    o === "win"
      ? " battle-row__result--win"
      : o === "loss"
        ? " battle-row__result--loss"
        : "";
  const body = (
    <>
      <span className="battle-row__when">
        {clockTime(battle.battle_time, zone)}
      </span>
      <span
        className={`mode-chip__dot mode-chip__dot--${battle.mode_group}`}
        aria-hidden="true"
      />
      <span className="battle-row__who">
        {battleWho(battle)}
        <span className="battle__note"> · {groupLabel(battle.mode_group)}</span>
      </span>
      <span className={`battle-row__result${tone}`}>{battleScore(battle)}</span>
    </>
  );
  return (
    <li>
      {battle.url ? (
        <Link className="battle-row" to={battlePath(battle.url)}>
          {body}
        </Link>
      ) : (
        <span className="battle-row">{body}</span>
      )}
    </li>
  );
}
