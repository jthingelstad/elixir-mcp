import {
  DeckGrid,
  Disclosure,
  Empty,
  FeedbackSheet,
  Icon,
  Link,
  Panel,
  useClock,
  useInitialTime,
} from "@elixir-mcp/ui";
import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import { useState } from "react";
import {
  OTHER,
  clockTime,
  floorNote,
  fmt,
  fourthTile,
  modeLabel,
  modeWords,
  pct,
  playerName,
  readModes,
  seasonHead,
  signed,
  weekRows,
} from "./ladder.js";
import {
  chipCalendar,
  seasonCalendar,
  spanLabel,
  weekdayOf,
} from "./ladder-days.js";
import { gapLine, formNames } from "./ladder-decks.js";
import { api } from "../api.js";
import { BringClanmates } from "../components/BringClanmates.jsx";
import { SETTINGS } from "../lib/settings.js";
import { useBattleSweep, useToolRead, useToolReads } from "../lib/queries.js";
import { DeckForm, SeasonForm, WeekForm } from "./Form.jsx";
import { YoungRecord } from "./YoungRecord.jsx";
import { Loading, ReadError, Record, Tile, useSeasonEdge } from "./common.jsx";

/** The season tab: one chip's season so far, as battles_performance reads it,
 *  its days on the account's calendar, week by week, and its deck played most.
 *  Every number is one the tools returned; the page adds no rate, pace or
 *  verdict. Other holds two games, so it is two panels and nothing else. */
export function Season(ctx) {
  const { player, mode, modeReady, season, summary, search } = ctx;
  const args = { player_tag: player.player_tag, season: season.arg };
  const reads = useToolReads(
    "battles_performance",
    readModes(mode).map((m) => ({ ...args, mode: m })),
    { enabled: modeReady },
  );
  return (
    <>
      {!modeReady || reads.some((r) => r.isPending) ? (
        <Loading what="the season" />
      ) : reads.some((r) => r.isError) ? (
        <ReadError
          error={reads.find((r) => r.isError).error}
          what="this season"
        />
      ) : mode === OTHER.key ? (
        <OtherSeason season={season} reads={reads} />
      ) : (
        <OneMode {...ctx} body={reads[0].data} args={args} />
      )}
      <YoungRecord player={player} summary={summary} />
      <BringClanmates />
      <SeasonExtras player={player} search={search} />
    </>
  );
}

const inSeason = (season, name) =>
  season.current ? "this season" : `in ${name ?? season.name}`;

function OneMode({
  player,
  mode,
  modeReady,
  season,
  seasons,
  summary,
  body,
  args,
  hrefFor,
}) {
  const w = body.window ?? {};
  const played = Number(w.battles ?? 0) > 0;
  const head = seasonHead(body.applied);
  const { when } = useClock();
  return (
    <>
      {played ? (
        <Summary mode={mode} season={season} body={body} head={head} />
      ) : (
        <Empty
          title={`No ${modeLabel(mode)} battles ${inSeason(season, head.name)}`}
          titleAs="h2"
        >
          {season.current
            ? `Elixir has recorded none in this mode since the season began${head.startsAt ? ` on ${when(head.startsAt)}` : ""}. Each mode keeps its own record; the others are a chip away.`
            : `Elixir recorded none in this mode in ${head.name}.`}
        </Empty>
      )}
      <Calendar
        player={player}
        mode={mode}
        season={season}
        modeReady={modeReady}
      />
      {played ? (
        <>
          <WeekByWeek mode={mode} args={args} running={season.current} />
          {season.current ? <WeekForm player={player} mode={mode} /> : null}
          <SeasonForm
            player={player}
            mode={mode}
            season={season}
            seasons={seasons}
            body={body}
            summary={summary}
          />
          <DeckForm player={player} mode={mode} season={season} />
          <TopDeck mode={mode} args={args} hrefFor={hrefFor} />
        </>
      ) : null}
    </>
  );
}

/** The chip's season in four tiles. The first says what it counts from, and
 *  from when the record begins when that is later than the season. */
function Summary({ mode, season, body, head }) {
  const { when } = useClock();
  const w = body.window ?? {};
  const fourth = fourthTile(mode, w, body.trophy_floor);
  const observed = body.meta?.source_polls?.player_battlelog?.observed_at;
  const from = w.from ?? head.startsAt;
  const begins =
    body.meta?.recorded_since &&
    head.startsAt &&
    Date.parse(body.meta.recorded_since) > Date.parse(head.startsAt);
  const note = floorNote(
    mode === "ladder" ? body.trophy_floor : null,
    inSeason(season, head.name),
  );
  const { zone } = useClock();
  return (
    <Panel
      title={
        season.current
          ? `${modeLabel(mode)} this season`
          : `${modeLabel(mode)} in ${head.name}`
      }
      action={
        mode === "casual" ? (
          <span className="ladder-aside">
            2v2, friendly and clanmate battles
          </span>
        ) : observed && season.current ? (
          <span className="ladder-aside">
            As of {clockTime(observed, zone)}
          </span>
        ) : null
      }
    >
      <div className="ladder-tiles">
        <Tile
          label="Battles"
          sub={
            !season.current
              ? `in ${head.name}`
              : from
                ? `since ${when(begins ? body.meta.recorded_since : from)}${begins ? ", when your record begins" : ""}`
                : null
          }
        >
          {fmt(w.battles)}
        </Tile>
        <Tile label="Record">
          <Record wins={w.wins} losses={w.losses} draws={w.draws} />
        </Tile>
        <Tile label="Won">{pct(w.win_rate)}</Tile>
        {fourth ? (
          <Tile
            label={fourth.label}
            small
            sub={
              fourth.label === "Trophy range" && w.net_trophies != null
                ? `net ${signed(w.net_trophies)}`
                : null
            }
          >
            {fourth.value}
          </Tile>
        ) : null}
      </div>
      {note ? <div className="panel__foot">{note}</div> : null}
    </Panel>
  );
}

/** Other: Challenge and Tournament, a panel each, and never one number. */
function OtherSeason({ season, reads }) {
  const name = seasonHead(reads[0].data?.applied).name;
  const groups = readModes(OTHER.key)
    .map((key, i) => ({ key, read: reads[i] }))
    .filter(({ read }) => Number(read.data?.window?.battles ?? 0) > 0);
  if (!groups.length)
    return (
      <Empty
        title={`No Challenge or Tournament battles ${inSeason(season, name)}`}
        titleAs="h2"
      >
        {season.current
          ? "Elixir has recorded none in this mode since the season began."
          : `Elixir recorded none in this mode in ${name}.`}
      </Empty>
    );
  return groups.map(({ key, read }, i) => {
    const w = read.data.window;
    const crowns = fourthTile(key, w, null);
    return (
      <Panel
        key={key}
        title={`${modeLabel(key)} ${inSeason(season, name)}`}
        action={
          i === 0 ? (
            <span className="ladder-aside">
              Other holds Challenge and Tournament, never pooled
            </span>
          ) : null
        }
      >
        <div className="ladder-tiles">
          <Tile label="Battles">{fmt(w.battles)}</Tile>
          <Tile label="Record">
            <Record wins={w.wins} losses={w.losses} draws={w.draws} />
          </Tile>
          {crowns ? <Tile label="Crowns">{crowns.value}</Tile> : null}
        </div>
        {i > 0 ? (
          <div className="panel__foot">
            A second read, its own panel. A Tournament is not a Challenge, so
            the two are never added up.
          </div>
        ) : null}
      </Panel>
    );
  });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The key lists only what this calendar draws, so nothing stands unexplained. */
const KEY = [
  ["l2", "Battles in this mode. Darker is more."],
  ["other", "None recorded in this mode, some in others."],
  ["quiet", "No battles: the whole day was read."],
  ["part", "Partly read. Unknown."],
  ["unk", "Unknown. No read covers this day."],
  ["unread", "Not read: past the newest 480 battles."],
  ["fut", "To come."],
];

/**
 * Days played: the season on the account's calendar, in this chip's mode. One
 * no-mode sweep draws every chip's calendar, and each mode keeps its own count:
 * another mode's battles show as a count on their day, never pooled into this
 * one. A day is "No battles" only when a whole-day read proves it.
 */
function Calendar({ player, mode, season, modeReady }) {
  const { zone } = useClock();
  const edge = useSeasonEdge();
  const [now] = useInitialTime();
  const coverage = useToolRead("elixir_coverage", {
    player_tag: player.player_tag,
  });
  const sweep = useBattleSweep(
    {
      player_tag: player.player_tag,
      season: season.arg,
      verbosity: "compact",
      limit: 40,
    },
    { enabled: modeReady },
  );
  const applied = sweep.data?.first?.applied?.window?.season ?? null;
  if (sweep.isPending)
    return (
      <Panel title="Days played">
        <div className="panel__body">
          <Loading what="the season's days" />
        </div>
      </Panel>
    );
  if (sweep.isError)
    return (
      <Panel title="Days played">
        <div className="panel__body">
          <ReadError error={sweep.error} what="the season's days" />
        </div>
      </Panel>
    );
  if (!applied?.starts_at) return null;
  const battles = sweep.data?.battles ?? [];
  const capped = Boolean(sweep.data?.capped);
  const cal = chipCalendar(
    seasonCalendar({
      battles,
      startsAt: applied.starts_at,
      endsAt: applied.ends_at,
      now,
      zone,
      readFrom: capped ? (battles.at(-1)?.battle_time ?? null) : null,
      observationIntervals: coverage.data?.observation_intervals ?? [],
    }),
    readModes(mode),
    { coverageFailed: coverage.isError },
  );
  const name = applied.war != null ? `Season ${applied.war}` : season.name;
  const shown = new Set(cal.days.map((d) => d.cls));
  const firstRead = cal.days.find((d) => d.state !== "unread");
  const toCome = cal.days.filter((d) => d.cls === "fut" && !d.today).length;
  return (
    <>
      {capped ? (
        <div className="callout callout--info" role="status">
          <Icon name="info" size={17} />
          <span>
            This page reads the newest {fmt(battles.length)} of{" "}
            {fmt(sweep.data.total)} battles in {name}, so the days before{" "}
            {firstRead?.label} are marked not read rather than drawn empty. Any
            battles already read stay visible.
          </span>
        </div>
      ) : null}
      {coverage.isError ? (
        <div className="callout callout--info" role="status">
          <Icon name="info" size={17} />
          <span>
            Coverage could not be checked, so a day without a recorded battle
            shows as unknown.
          </span>
        </div>
      ) : null}
      <Panel
        title="Days played"
        action={
          <span className="ladder-aside">
            {fmt(cal.played)} {cal.played === 1 ? "day" : "days"} with recorded
            battles, of {fmt(cal.of)}
            {season.current ? " so far" : ""}
          </span>
        }
      >
        <ol className="ladder-cal" aria-label={`${modeWords(mode)} by day`}>
          {WEEKDAYS.map((w) => (
            <li key={w} className="ladder-cal__wd" aria-hidden="true">
              {w}
            </li>
          ))}
          {Array.from({ length: cal.lead }, (_, i) => (
            <li
              key={`lead${i}`}
              className="ladder-cal__lead"
              aria-hidden="true"
            />
          ))}
          {cal.days.map((d) => (
            <li
              key={d.ymd}
              className={`ladder-day ladder-day--${d.cls}${d.today ? " ladder-day--today" : ""}`}
              aria-current={d.today ? "date" : undefined}
            >
              <span className="ladder-day__n">
                <span className="ladder-day__wd">{weekdayOf(d.ymd)} </span>
                {d.label}
              </span>
              {d.text ? <span>{d.text}</span> : null}
            </li>
          ))}
        </ol>
        {toCome ? (
          <p className="ladder-cal__ahead">
            {fmt(toCome)} {toCome === 1 ? "day" : "days"} to come. The season
            ends {edge(applied.ends_at)}.
          </p>
        ) : null}
        <ul className="ladder-legend">
          {KEY.filter(([cls]) =>
            cls === "l2" ? cal.played > 0 : shown.has(cls),
          ).map(([cls, words]) => (
            <li key={cls} className={`ladder-legend__${cls}`}>
              <span
                className={`ladder-swatch ladder-day--${cls}`}
                aria-hidden="true"
              />
              {words}
            </li>
          ))}
        </ul>
        <div className="panel__foot">
          {mode === "ladder"
            ? `${name} ${season.current ? "runs" : "ran"} ${edge(applied.starts_at)} to ${edge(applied.ends_at)}. Battles after midnight count on the next day.`
            : "Same key in every mode. Other modes show as a count, never pooled into this one."}
          {cal.gap
            ? ` Longest stretch with no battles in this mode, all days fully read: ${fmt(cal.gap.length)} ${cal.gap.length === 1 ? "day" : "days"}, ${spanLabel(cal.gap)}.`
            : ""}
        </div>
      </Panel>
    </>
  );
}

/** Newest week first, each a record and a bar of its wins and losses. */
function WeekByWeek({ mode, args, running }) {
  const trophies = mode === "ladder" || mode === "ranked";
  const weeks = useToolRead("battles_performance", {
    ...args,
    mode,
    group_by: "week",
  });
  const rows = weeks.data
    ? weekRows(weeks.data.weekly, { net: trophies, running })
    : [];
  return (
    <Panel title="Week by week">
      {weeks.isPending ? (
        <div className="panel__body">
          <Loading what="the weeks" />
        </div>
      ) : weeks.isError ? (
        <div className="panel__body">
          <ReadError error={weeks.error} what="the weeks" />
        </div>
      ) : (
        <ol className="ladder-wks">
          {rows.map((r) => (
            <li key={r.key} className="ladder-wk">
              <span className="ladder-wk__label">{r.label}</span>
              <svg
                className="ladder-bar"
                width="100%"
                height="8"
                aria-hidden="true"
              >
                <rect
                  className="ladder-bar__w"
                  width={`${r.winShare}%`}
                  height="8"
                />
                <rect
                  className="ladder-bar__l"
                  x={`${r.winShare}%`}
                  width={`${100 - r.winShare}%`}
                  height="8"
                />
              </svg>
              <span className="ladder-wk__note">{r.note}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="panel__foot">
        Partial weeks compare by win rate, never by count.
        {trophies ? " Signed numbers are net trophies." : ""}
        {mode === "war"
          ? " Calendar weeks do not line up with race weeks."
          : ""}
      </div>
    </Panel>
  );
}

/** The most battles in this chip's mode and this season: the Decks tab's own
 *  read, so moving between the two reads it once. */
function TopDeck({ mode, args, hrefFor }) {
  const { when } = useClock();
  const base = { ...args, mode };
  const list = useToolRead("battles_decks", { ...base, limit: 100 });
  const top = list.data?.decks?.[0] ?? null;
  const detail = useToolRead(
    "battles_decks",
    { ...base, deck_hash: top?.deck_hash },
    { enabled: Boolean(top) },
  );
  if (list.isPending || list.isError || !top) return null;
  const full =
    detail.data?.decks?.find((r) => r.deck_hash === top.deck_hash) ?? null;
  const name = top.archetype_label ?? "Unnamed deck";
  const forms = formNames(full ?? top);
  const line = [
    full?.archetype?.average_elixir != null
      ? `${Number(full.archetype.average_elixir).toFixed(2)} average elixir.`
      : null,
    top.tower_troop_name ? `${top.tower_troop_name}.` : null,
    `${fmt(top.wins)}–${fmt(top.losses)}${top.win_rate != null ? `, ${pct(top.win_rate)} won` : ""}.`,
    (() => {
      const gap = gapLine(top.mean_level_gap);
      return gap ? `${gap[0].toUpperCase()}${gap.slice(1)}.` : null;
    })(),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Panel
      title="Most played deck"
      action={
        <Link to={hrefFor({ slug: "decks" })}>Every deck you played ›</Link>
      }
    >
      <div className="panel__body ladder-top">
        <p className="ladder-top__name">{name}</p>
        <p className="ladder-top__sub">
          {fmt(top.battles)} {top.battles === 1 ? "battle" : "battles"}
          {top.last_used ? `, last played ${when(top.last_used)}` : ""}
          {forms ? ` · ${forms}` : ""}
        </p>
        {full?.cards?.length ? (
          <DeckGrid
            cards={full.cards}
            size={52}
            columns={8}
            showLevel={false}
            label={`Cards in ${name}`}
          />
        ) : detail.isPending ? (
          <Loading what="the cards" />
        ) : (
          <p className="ladder-top__sub">{top.card_names}</p>
        )}
        <p className="ladder-top__line">{line}</p>
      </div>
    </Panel>
  );
}

/** What the record is, and feedback about Ladder, at the foot of Season. */
function SeasonExtras({ player, search }) {
  const [feedback, setFeedback] = useState(false);
  return (
    <>
      <Disclosure title="About this record">
        <p className="m-0 text-[13.5px] text-ink-body">
          Each mode is its own game and keeps its own record. Ladder reads the
          recorded battles, without pooling modes or rating players. Counts and
          gaps in the record are shown with the figures they affect.
        </p>
      </Disclosure>
      <div>
        <button
          type="button"
          className="btn btn--sm btn--quiet"
          onClick={() => setFeedback(true)}
        >
          Send feedback about Ladder
        </button>
      </div>
      {feedback ? (
        <FeedbackSheet
          area="ladder"
          categories={FEEDBACK_CATEGORIES}
          about={`About Stats, ${playerName(player)}'s season. The page you are on rides along.`}
          refs={[{ kind: "player", ref: player.player_tag }]}
          context={{
            page: "season",
            ...(search.mode ? { mode: search.mode } : {}),
            ...(search.season != null ? { season: String(search.season) } : {}),
          }}
          send={api.sendFeedback}
          onClose={() => setFeedback(false)}
          itemHref={(id) => `${SETTINGS}/feedback/${id}`}
          historyHref={`${SETTINGS}/feedback`}
        />
      ) : null}
    </>
  );
}
