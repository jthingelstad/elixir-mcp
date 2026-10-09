import { DeckGrid, Icon, Link, useClock, noun } from "@elixir-mcp/ui";
import {
  LADDER_PAGES,
  clockTime,
  deckModes,
  fmt,
  floorNote,
  fourthTile,
  ladderHref,
  longDay,
  modeLabel,
  pct,
  seasonHead,
  shortDay,
  signed,
  weekBars,
  zoneShort,
} from "./ladder.js";
import { useToolRead } from "../lib/queries.js";
import { BringClanmates } from "../components/BringClanmates.jsx";
import {
  LadderHead,
  Loading,
  ModeSwitch,
  ReadError,
  Record,
  Tile,
} from "./common.jsx";

/**
 * The season home (Ladder.dc.html): one mode's season so far, as
 * battles_performance reads it, week by week, and the deck played most
 * over the last 30 days as players_summary names it. Every number is
 * one the tools returned; the page adds no rate, pace or verdict.
 */
export function Season({
  player,
  mode,
  modeReady,
  season,
  seasonPicker,
  summary,
  search,
}) {
  const { zone } = useClock();
  const args = { player_tag: player.player_tag, season: season.arg, mode };
  const perf = useToolRead("battles_performance", args, { enabled: modeReady });
  const weeks = useToolRead(
    "battles_performance",
    { ...args, group_by: "week" },
    { enabled: modeReady },
  );

  const body = perf.data;
  const head = seasonHead(body?.applied);
  const at = (ts) =>
    `${longDay(ts, zone)} at ${clockTime(ts, zone)} ${zoneShort(ts, zone)}`;
  const ends = !head.endsAt
    ? ""
    : head.running
      ? ` The season ends ${at(head.endsAt)}.`
      : head.startsAt
        ? ` The season ran ${at(head.startsAt)} to ${at(head.endsAt)}.`
        : "";
  const hrefFor = (m) =>
    ladderHref("season", {
      player: search.player,
      mode: m,
      season: search.season,
    });

  return (
    <div className="ladder-page">
      <LadderHead
        player={player}
        page="Season"
        title={
          head.running && head.age != null
            ? `${head.name} · ${fmt(head.age)} ${noun(head.age, "day")} in`
            : body
              ? head.name
              : season.name
        }
        lede={`Each mode is its own game, so each has its own tab and nothing pools across them.${ends}`}
        observedAt={body?.meta?.source_polls?.player_battlelog?.observed_at}
        season={season}
        seasonPicker={seasonPicker}
      />
      <ModeSwitch mode={mode} hrefFor={hrefFor} />

      {!modeReady || perf.isPending ? (
        <Loading what="the season" />
      ) : perf.isError ? (
        <ReadError error={perf.error} what="this season" />
      ) : (
        <SeasonBody
          mode={mode}
          body={body}
          weeks={weeks}
          summary={summary}
          search={search}
          zone={zone}
          startsAt={head.startsAt}
          running={head.running || season.current}
          seasonName={head.name}
        />
      )}
      <BringClanmates className="mt-6" />
    </div>
  );
}

function SeasonBody({
  mode,
  body,
  weeks,
  summary,
  search,
  zone,
  startsAt,
  running,
  seasonName,
}) {
  const w = body.window ?? {};
  const played = Number(w.battles ?? 0) > 0;
  const fourth = fourthTile(mode, w, body.trophy_floor);
  const note =
    mode === "ladder"
      ? floorNote(
          body.trophy_floor,
          running ? "this season" : `in ${seasonName}`,
        )
      : null;
  return (
    <>
      {played ? (
        <>
          <div className="ladder-tiles">
            <Tile label="Battles">{fmt(w.battles)}</Tile>
            <Tile label="Record">
              <Record wins={w.wins} losses={w.losses} draws={w.draws} />
            </Tile>
            <Tile label="Won">{pct(w.win_rate)}</Tile>
            {fourth ? (
              <Tile label={fourth.label} small>
                {fourth.value}
              </Tile>
            ) : null}
          </div>
          {note ? (
            <div className="callout callout--info">
              <Icon name="info" size={17} />
              <span>{note}</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty">
          <h2 className="empty__title">
            No {modeLabel(mode)} battles{" "}
            {running ? "this season" : `in ${seasonName}`}
          </h2>
          <p className="empty__body">
            {running
              ? `Elixir has recorded none in this mode since the season began${
                  startsAt
                    ? ` on ${longDay(startsAt, zone)} at ${clockTime(startsAt, zone)} ${zoneShort(startsAt, zone)}`
                    : ""
                }.`
              : `Elixir recorded none in this mode in ${seasonName}.`}{" "}
            Each mode keeps its own record; the others are a tab away.
          </p>
        </div>
      )}

      <div className="ladder-split">
        {played ? <WeekByWeek mode={mode} weeks={weeks} /> : null}
        {running ? (
          <TopDeck
            summary={summary}
            search={search}
            zone={zone}
            wide={!played}
          />
        ) : (
          <SeasonDecks search={search} name={seasonName} wide={!played} />
        )}
      </div>
    </>
  );
}

/** Wins up in blue, losses down in rose, one column per ISO week of the
 *  season, oldest on the left the way a chart reads. A partial week is
 *  marked, and its rate is the one to compare (the tool's own note). */
function WeekByWeek({ mode, weeks }) {
  const trophies = mode === "ladder" || mode === "ranked";
  const bars = weeks.data ? weekBars(weeks.data.weekly, { net: trophies }) : [];
  return (
    <section className="panel ladder-span-3" aria-labelledby="ladder-weeks">
      <div className="panel__head">
        <h2 id="ladder-weeks" className="ladder-panel-title">
          Week by week
        </h2>
        <span className="ladder-key">
          <span className="ladder-key__swatch ladder-key__swatch--win" />
          wins
        </span>
        <span className="ladder-key">
          <span className="ladder-key__swatch ladder-key__swatch--loss" />
          losses
        </span>
      </div>
      <div className="panel__body">
        {weeks.isPending ? (
          <Loading what="the weeks" />
        ) : weeks.isError ? (
          <ReadError error={weeks.error} what="the weeks" />
        ) : bars.length === 0 ? (
          <p className="text-ink-faint">No weeks to show yet.</p>
        ) : (
          <ol className="ladder-weeks">
            {bars.map((b) => (
              <li key={b.key} className="ladder-week">
                <WeekBars bar={b} />
                <span className="ladder-week__date">{b.label}</span>
                {b.note ? (
                  <span className="ladder-week__note">{b.note}</span>
                ) : null}
                <span className="ladder-week__note">{pct(b.rate)} won</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="panel__foot">
        Partial weeks compare by win rate, never by count.
        {trophies ? " Signed numbers are net trophies." : ""}
      </div>
    </section>
  );
}

/** One week's two bars. SVG, so a bar's height is an attribute the data
 *  sets rather than a style: the axis sits at 76, wins grow up from it
 *  and losses down, and a count sits inside its bar when the bar is tall
 *  enough to hold it, beside the axis when it is not. */
const AXIS = 76;
function WeekBars({ bar }) {
  const inWin = bar.winH >= 20;
  const inLoss = bar.lossH >= 20;
  return (
    <svg
      className="ladder-week__chart"
      width="100%"
      height="196"
      role="img"
      aria-label={`Week of ${bar.label}${bar.partial ? " (partial)" : ""}: ${bar.wins} won, ${bar.losses} lost`}
    >
      <line
        className="ladder-week__axis"
        x1="0"
        x2="100%"
        y1={AXIS + 0.5}
        y2={AXIS + 0.5}
      />
      <svg x="50%" overflow="visible">
        {bar.winH > 0 ? (
          <rect
            className="ladder-bar--win"
            x="-22"
            y={AXIS - bar.winH}
            width="44"
            height={bar.winH}
            rx="5"
          />
        ) : null}
        {bar.lossH > 0 ? (
          <rect
            className="ladder-bar--loss"
            x="-22"
            y={AXIS + 1}
            width="44"
            height={bar.lossH}
            rx="5"
          />
        ) : null}
      </svg>
      <text
        className={`ladder-bar__n${inWin ? "" : " ladder-bar__n--out"}`}
        x="50%"
        y={inWin ? AXIS - bar.winH + 15 : AXIS - bar.winH - 5}
        textAnchor="middle"
      >
        {bar.wins}
      </text>
      <text
        className={`ladder-bar__n${inLoss ? "" : " ladder-bar__n--out"}`}
        x="50%"
        y={inLoss ? AXIS + bar.lossH - 5 : AXIS + bar.lossH + 15}
        textAnchor="middle"
      >
        {bar.losses}
      </text>
    </svg>
  );
}

/** players_summary's top_deck: the deck played most over the last 30
 *  days, all modes, with its record per mode. A rate shows only when it
 *  is one mode's own (ladder.js deckModes). */
function TopDeck({ summary, search, zone, wide }) {
  const deck = summary.data?.top_deck ?? null;
  const decksPage = LADDER_PAGES.some((p) => p.slug === "decks");
  return (
    <section
      className={`panel ${wide ? "ladder-span-5" : "ladder-span-2"} ladder-deck`}
      aria-labelledby="ladder-top-deck"
    >
      <div className="panel__head">
        <h2 id="ladder-top-deck" className="ladder-panel-title">
          Most-played deck
        </h2>
        <span className="text-[12.5px] font-normal text-ink-faint">
          last 30 days
        </span>
      </div>
      <div className="panel__body ladder-deck__body">
        {summary.isPending ? (
          <Loading what="your decks" />
        ) : summary.isError ? (
          <ReadError error={summary.error} what="your decks" />
        ) : !deck ? (
          <p className="text-ink-faint">
            No battles recorded in the last 30 days.
          </p>
        ) : (
          <>
            <div>
              <p className="ladder-deck__name">
                {deck.archetype?.label ?? "Unnamed deck"}
              </p>
              <p className="ladder-deck__sub">
                {[
                  deck.archetype?.average_elixir != null
                    ? `${deck.archetype.average_elixir.toFixed(2)} average elixir`
                    : null,
                  deck.last_played_at
                    ? `last played ${shortDay(deck.last_played_at, zone)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <DeckGrid
              cards={deck.cards ?? []}
              size={52}
              showLevel={false}
              label={`Cards in ${deck.archetype?.label ?? "the deck"}`}
            />
            <dl className="ladder-facts">
              {deckModes(deck).map((m) => (
                <div key={m.key} className="ladder-fact">
                  <dt>{m.label}</dt>
                  <dd>
                    <Record wins={m.wins} losses={m.losses} />
                    {m.rate != null ? (
                      <span className="ladder-fact__aside">{pct(m.rate)}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
              {deck.mean_level_gap != null ? (
                <div className="ladder-fact">
                  <dt>Mean level gap</dt>
                  <dd>{signed(deck.mean_level_gap, 2)}</dd>
                </div>
              ) : null}
            </dl>
            {decksPage ? (
              <Link
                className="ladder-more"
                to={ladderHref("decks", {
                  player: search.player,
                  mode: search.mode,
                  season: search.season,
                })}
              >
                Every deck you played ›
              </Link>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** An earlier season's home: the most-played deck panel is the last 30
 *  days (players_summary), which is not that season, so the panel points
 *  to the season's own decks instead. */
function SeasonDecks({ search, name, wide }) {
  return (
    <section
      className={`panel ${wide ? "ladder-span-5" : "ladder-span-2"} ladder-deck`}
      aria-labelledby="ladder-season-decks"
    >
      <div className="panel__head">
        <h2 id="ladder-season-decks" className="ladder-panel-title">
          Decks
        </h2>
      </div>
      <div className="panel__body ladder-deck__body">
        <p className="text-ink-faint">
          Every deck you played in {name}, each in the mode it was played in.
        </p>
        <Link
          className="ladder-more"
          to={ladderHref("decks", {
            player: search.player,
            mode: search.mode,
            season: search.season,
          })}
        >
          The decks of {name} ›
        </Link>
      </div>
    </section>
  );
}
