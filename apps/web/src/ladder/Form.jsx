import { noun, useClock } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import {
  FORM_MIN_BATTLES,
  deckChange,
  deckForm,
  formArgs,
  formWindows,
  gameWeekStartMs,
  samePointWindow,
  seasonSide,
  weekForm,
} from "@elixir-mcp/record/form";
import {
  clockTime,
  formRows,
  longDay,
  modeLabel,
  previousSeason,
  seasonName,
  seasonRows,
  seasonWords,
  shortDay,
  zoneShort,
} from "./ladder.js";
import { useToolRead } from "../lib/queries.js";
import { Loading, ReadError } from "./common.jsx";

/**
 * "Am I improving?" (2026-10-08), read back as numbers: the game week
 * so far beside the four before it, the season before and since the
 * deck played most arrived, and (2026-10-20) the season beside the one
 * before it. Each is a battles_performance read in the page's one mode,
 * shaped by @elixir-mcp/record/form (the same functions the Arena mail's
 * line uses). A side below FORM_MIN_BATTLES is never set beside
 * another: the week and deck panels are not drawn, and the season
 * panel says in a sentence that a side has too few. No arrow, colour or
 * word says which side is better.
 */

/** The game week so far (Monday 10:00Z, named in the reader's zone)
 *  beside the four whole game weeks before it. The current season only:
 *  "this week" means nothing on a season that has closed. */
export function WeekForm({ player, mode }) {
  const { zone } = useClock();
  // The week this page was opened in; a page left open across Monday's
  // reset keeps the week it said it was showing.
  const [start] = useState(() => gameWeekStartMs());
  const windows = formWindows(start, { running: true });
  const perf = useToolRead(
    "battles_performance",
    formArgs(windows, mode, { player_tag: player.player_tag }),
  );
  const form = perf.data ? weekForm(perf.data, mode) : null;
  if (!form) return null;
  const from = windows.week.from;
  return (
    <FormPanel
      title="This week vs your last 4"
      aside={modeLabel(mode)}
      cols={["This week", "Last 4 weeks"]}
      a={form.week}
      b={form.previous}
      foot={`Game weeks start Monday at 10:00 UTC; this one began ${longDay(from, zone)} at ${clockTime(from, zone)} ${zoneShort(from, zone)} and runs to now. Each number is shown once both sides have at least ${FORM_MIN_BATTLES} battles; each count is the battles it is over.`}
    />
  );
}

/** The season before and since the deck played most in it arrived: its
 *  first battle splits the season (battles_decks' first_used), and
 *  battles_performance's before_after reads both sides, every deck
 *  included. Drawn only when that deck came after others and both
 *  sides reach the minimum. */
export function DeckForm({ player, mode, season }) {
  const { zone } = useClock();
  const base = { player_tag: player.player_tag, season: season.arg, mode };
  // The Decks page's own read of this mode's season (the same key), so
  // moving between the two pages reads it once.
  const decks = useToolRead("battles_decks", { ...base, limit: 100 });
  const change = decks.data ? deckChange(decks.data) : null;
  const perf = useToolRead(
    "battles_performance",
    { ...base, before_after: change?.since ?? "" },
    { enabled: Boolean(change) },
  );
  const form = change && perf.data ? deckForm(perf.data, mode) : null;
  const opened = decks.data?.applied?.window?.from ?? null;
  // What was played most before it: battles_decks over the stretch
  // before the split, its first row.
  const earlier = useToolRead(
    "battles_decks",
    {
      player_tag: player.player_tag,
      mode,
      from: opened ?? "",
      to: change?.since ?? "",
      limit: 1,
    },
    { enabled: Boolean(form && opened) },
  );
  if (!change || !form) return null;
  const name = change.label ?? "Your most-played deck";
  const before = earlier.data?.decks?.[0]?.archetype_label ?? null;
  return (
    <FormPanel
      title={`Before and since ${name}`}
      aside={modeLabel(mode)}
      lede={`${name} is the deck you played most ${seasonWords(season)} in ${modeLabel(mode)} (${change.battles} ${change.battles === 1 ? "battle" : "battles"}). Its first battle was ${longDay(change.since, zone)} at ${clockTime(change.since, zone)} ${zoneShort(change.since, zone)}. Your ${modeLabel(mode)} record before it, and since, every deck included:`}
      cols={[
        `Before ${shortDay(change.since, zone)}`,
        `Since ${shortDay(change.since, zone)}`,
      ]}
      a={form.before}
      b={form.since}
      foot={`${before && before !== change.label ? `Before it, the deck you played most was ${before}. ` : ""}Each number is shown once both sides have at least ${FORM_MIN_BATTLES} battles; each count is the battles it is over. A deck's name describes its cards, never how well it plays.`}
    />
  );
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** "24 days and 11 hours": a stretch's length, as the same-point window
 *  was cut, to the hour. */
function stretch(ms) {
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const d = `${days} ${noun(days, "day")}`;
  return hours ? `${d} and ${hours} ${noun(hours, "hour")}` : d;
}

/**
 * This season beside the last (Jamie, 2026-10-20): the season the page
 * reads beside the one before it on record, in the page's one mode. A
 * season still running is "so far" and sits beside last season to the
 * same point (as far in, to the hour) and beside all of last season; a
 * closed season sits beside the one before, both whole. A side under
 * FORM_MIN_BATTLES decided battles is not set beside another (Form is
 * numbers only): the panel says so instead, and reads nothing it would
 * not show.
 *
 * This season's side is the season home's own read (`body`) and
 * DeckForm's battles_decks read of the season (the same key, read once).
 * Once this season reaches the minimum, last season adds one
 * battles_performance read (the season as its window, the same point as
 * compare_from/compare_to; with no same point it is the season home's
 * own read of that season) and, for each of its sides that reaches the
 * minimum, battles_decks: the season (the Decks page's key) and the same
 * point. No previous season on record, no read.
 */
export function SeasonForm({ player, mode, season, seasons, body, summary }) {
  const { zone } = useClock();
  // The hour this page was opened in: the same-point window holds still
  // while the page is open.
  const [nowMs] = useState(() => Date.now());
  const applied = body?.applied?.window ?? {};
  const shown = applied.season ?? null;
  const running = Boolean(shown) && applied.to == null;
  const prev = previousSeason(seasons, season);
  const same =
    running && prev
      ? samePointWindow({
          startsAt: shown.starts_at,
          previousStartsAt: prev.startsAt,
          previousEndsAt: shown.starts_at,
          nowMs,
        })
      : null;
  const tag = player.player_tag;
  // This season's numbers, before any read: under the minimum there is
  // nothing to set beside, so last season is not read.
  const enough = seasonSide(body?.window, mode) != null;
  const last = useToolRead(
    "battles_performance",
    {
      player_tag: tag,
      season: prev?.arg ?? "",
      mode,
      ...(same ? { compare_from: same.from, compare_to: same.to } : {}),
    },
    { enabled: Boolean(prev) && enough },
  );
  const thisDecks = useToolRead("battles_decks", {
    player_tag: tag,
    season: season.arg,
    mode,
    limit: 100,
  });
  const lastSeen = seasonSide(last.data?.window, mode) != null;
  const sameSeen =
    lastSeen &&
    Boolean(same) &&
    seasonSide(last.data?.compare_window, mode) != null;
  const lastDecks = useToolRead(
    "battles_decks",
    { player_tag: tag, season: prev?.arg ?? "", mode, limit: 100 },
    { enabled: lastSeen },
  );
  // limit 1: total_decks counts every deck whatever the page size.
  const sameDecks = useToolRead(
    "battles_decks",
    {
      player_tag: tag,
      mode,
      from: same?.from ?? "",
      to: same?.to ?? "",
      limit: 1,
    },
    { enabled: sameSeen },
  );

  // A list that could not be read says nothing rather than "no season".
  if (prev === undefined || (seasons ?? []).length === 0) return null;
  const name = seasonName(shown);
  const label = modeLabel(mode);
  const here = running ? "this season" : name;
  const panel = {
    title: running
      ? "This season vs last"
      : `${name} vs ${prev?.name ?? "the season before"}`,
    aside: label,
  };
  const say = (text, foot = null) => (
    <FormPanel {...panel} foot={foot}>
      <p className="ladder-form__lede">{text}</p>
    </FormPanel>
  );
  if (prev === null)
    return say(
      `Elixir's record of you holds no season before ${name}, so there is nothing to set beside it.`,
    );
  if (!enough)
    return say(
      running
        ? `This season has fewer than ${FORM_MIN_BATTLES} decided ${label} battles so far, so it is not set beside ${prev.name} yet.`
        : `${name} has fewer than ${FORM_MIN_BATTLES} decided ${label} battles, so it is not set beside ${prev.name}.`,
    );

  const since = Date.parse(summary?.data?.meta?.recorded_since ?? "");
  const partial =
    Number.isFinite(since) && since > Date.parse(prev.startsAt ?? "")
      ? `Elixir's record of you begins ${longDay(since, zone)}, partway through ${prev.name}, so not all of that season is on record.`
      : null;
  const pending =
    last.isPending ||
    thisDecks.isPending ||
    (lastSeen && lastDecks.isPending) ||
    (sameSeen && sameDecks.isPending);
  if (pending)
    return (
      <FormPanel {...panel}>
        <Loading what="last season" />
      </FormPanel>
    );
  if (last.isError)
    return (
      <FormPanel {...panel}>
        <ReadError error={last.error} what={prev.name} />
      </FormPanel>
    );
  if (!(Number(last.data.window?.battles ?? 0) > 0))
    return say(
      `Elixir recorded no ${label} battles in ${prev.name}, so there is nothing to set beside ${here}.`,
      partial,
    );
  if (!lastSeen)
    return say(
      `Elixir recorded fewer than ${FORM_MIN_BATTLES} decided ${label} battles in ${prev.name}, so it is not set beside ${here}.`,
      partial,
    );

  const decks = (read) => (read.isError ? null : read.data);
  const sides = [
    seasonSide(body.window, mode, decks(thisDecks)),
    ...(sameSeen
      ? [seasonSide(last.data.compare_window, mode, decks(sameDecks))]
      : []),
    seasonSide(last.data.window, mode, decks(lastDecks)),
  ];
  const cols = running
    ? [
        `${name} so far`,
        ...(sameSeen ? [`${prev.name} to the same point`] : []),
        `All of ${prev.name}`,
      ]
    : [name, prev.name];
  const ran = (days) =>
    days != null ? ` ran ${days} ${noun(days, "day")}` : "";
  const lastRan = ran(last.data.applied?.window?.season_age_days ?? null);
  const at = (ts) =>
    `${longDay(ts, zone)} at ${clockTime(ts, zone)} ${zoneShort(ts, zone)}`;
  const point = same
    ? `${prev.name} to the same point is its first ${stretch(Date.parse(same.to) - Date.parse(same.from))}, to ${at(same.to)}: as far into it, to the hour, as this season is now.`
    : null;
  // A running season with no same point is under an hour old, has run
  // at least as long as last season did (samePointWindow), or has a
  // start (its own or last season's) that is not known. The first-hour
  // sentence promises a same point after the hour, so it needs both
  // starts: without last season's, there will be none.
  const lastStart = Date.parse(prev.startsAt ?? "");
  const thisStart = Date.parse(shown?.starts_at ?? "");
  const age = nowMs - thisStart;
  const firstHour =
    Number.isFinite(lastStart) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < HOUR_MS;
  const longer =
    Number.isFinite(lastStart) &&
    Number.isFinite(thisStart) &&
    age >= thisStart - lastStart;
  const when = !running
    ? `${name}${ran(applied.season_age_days ?? null)} and ${prev.name}${lastRan}; each is read whole.`
    : sameSeen
      ? `${point} All of ${prev.name}${lastRan}.`
      : same
        ? `${point} It has fewer than ${FORM_MIN_BATTLES} decided ${label} battles, so it is not shown. All of ${prev.name}${lastRan}.`
        : firstHour
          ? `This season is not yet an hour old, so ${prev.name} to the same point is not shown: it is set beside this season from its first whole hour. All of ${prev.name}${lastRan}.`
          : longer
            ? `This season has run as long as ${prev.name} did, so all of ${prev.name} is set beside it.`
            : `All of ${prev.name}${lastRan}.`;
  const floored = [
    body.trophy_floor?.floored ? name : null,
    last.data.trophy_floor?.floored ? prev.name : null,
  ].filter(Boolean);
  const floor =
    mode === "ladder" && floored.length
      ? `In ${floored.join(" and ")} you stood on an arena floor, where a loss costs no trophies.`
      : null;
  return (
    <FormPanel
      {...panel}
      lede={`Your ${label} record ${running ? "so far this season" : `in ${name}`}, beside ${prev.name}'s.`}
      cols={cols}
      rows={seasonRows(sides)}
      foot={[
        when,
        partial,
        floor,
        `A side is shown from ${FORM_MIN_BATTLES} decided battles; each count is the battles its number is over. Decks played counts each exact deck once, as Decks does${mode === "war" ? "; a duel has no single deck and is not in it" : ""}.`,
        "The numbers are each season's own record; they do not say why the seasons differ.",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function FormPanel({
  title,
  aside,
  lede = null,
  cols = [],
  a,
  b,
  rows: given,
  foot = null,
  children = null,
}) {
  const id = useId();
  const rows = given ?? formRows(a, b);
  return (
    <section className="panel ladder-form" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          {title}
        </h2>
        <span className="text-[12.5px] font-normal text-ink-faint">
          {aside}
        </span>
      </div>
      <div className="panel__body">
        {lede ? <p className="ladder-form__lede">{lede}</p> : null}
        {children ?? (
          <table className="ladder-form__table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Number</span>
                </th>
                {cols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((cell, i) => (
                    <td key={cols[i]}>
                      <span className="ladder-form__value">
                        {cell.said ? (
                          <>
                            <span aria-hidden="true">{cell.value}</span>
                            <span className="sr-only">{cell.said}</span>
                          </>
                        ) : (
                          cell.value
                        )}
                      </span>
                      <span className="ladder-form__count">{cell.count}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {foot ? <div className="panel__foot">{foot}</div> : null}
    </section>
  );
}
