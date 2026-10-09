import { useClock } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import {
  FORM_MIN_BATTLES,
  deckChange,
  deckForm,
  formArgs,
  formWindows,
  gameWeekStartMs,
  weekForm,
} from "@elixir-mcp/record/form";
import {
  clockTime,
  formRows,
  longDay,
  modeLabel,
  seasonWords,
  shortDay,
  zoneShort,
} from "./ladder.js";
import { useToolRead } from "../lib/queries.js";

/**
 * "Am I improving?" (2026-10-08), read back as numbers: the game week
 * so far beside the four before it, and the season before and since the
 * deck played most arrived. Each is one battles_performance read in the
 * page's one mode, shaped by @elixir-mcp/record/form (the same function
 * the Arena mail's line uses). Below FORM_MIN_BATTLES a panel is not
 * drawn at all. No arrow, colour or word says which side is better.
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

function FormPanel({ title, aside, lede = null, cols, a, b, foot }) {
  const id = useId();
  const rows = formRows(a, b);
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
                    <span className="ladder-form__value">{cell.value}</span>
                    <span className="ladder-form__count">{cell.count}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel__foot">{foot}</div>
    </section>
  );
}
