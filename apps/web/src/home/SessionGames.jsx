import { DeckRow, Link, TagText, noun, useClock } from "@elixir-mcp/ui";
import { playerHref } from "../lib/player.js";
import { modeWord } from "./logic.js";
import {
  deckRuns,
  gameScore,
  nameOf,
  sameCards,
  trophyWord,
} from "./session-games.js";

/**
 * An opened session (Home's feed and a player's Timeline; Jamie,
 * 2026-11-13: "lacking any styling... could show much better info there"):
 * the sitting's games newest first, grouped by the deck they were played
 * with, each a compact row of its result, score, who was on the other side
 * (and a 2v2's teammate), a duel's games, the trophies it moved and a way
 * to the battle page. Facts the read carries; a fact the record lacks is
 * left out, never guessed. The figures and the sparkline stay on the item
 * above.
 */
export function SessionGames({ item, query, offset, setOffset, onRefresh }) {
  const { when, clock } = useClock();
  if (query.isPending || (query.isFetching && !query.isSuccess))
    return (
      <div className="kit-sgames">
        <p className="kit-sgames__reading" role="status">
          Reading the games…
        </p>
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="kit-sgames" role="alert">
        <p className="kit-sgames__note">
          These games changed since the feed was read. Refresh to see them.
        </p>
        <button className="btn btn--sm" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    );
  const ev = query.data;
  const battles = ev.battles ?? [];
  const decks = ev.decks ?? [];
  const manyModes = Object.keys(item.facts?.by_mode ?? {}).length > 1;
  const runs = deckRuns(battles, decks);
  const shown = item.deck ?? null;
  // The item already shows its most played deck's cards: a page played
  // with that deck alone names it and leaves the cards above.
  const oneDeckShown =
    runs.length === 1 && runs[0].deck && sameCards(runs[0].deck, shown);
  return (
    <div className="kit-sgames" aria-busy={query.isFetching}>
      <p className="kit-sgames__head">
        <b>
          {ev.count} {noun(ev.count, "battle")}
        </b>
        <span> · newest first</span>
        {ev.open ? <span className="chip chip--ok">Still playing</span> : null}
      </p>
      {typeof item.facts?.battles === "number" &&
      item.facts.battles !== ev.count ? (
        <p className="kit-sgames__note">
          The update counts {item.facts.battles}{" "}
          {noun(item.facts.battles, "battle")}; {ev.count} are on record here.
        </p>
      ) : null}
      {item.kind === "session_standout" ? (
        <p className="kit-sgames__note">
          These end at the milestone this update names. Later battles in the
          same session aren’t here.
        </p>
      ) : null}
      {battles.length === 0 ? (
        <p className="kit-sgames__note">No battles recorded on this page.</p>
      ) : null}
      {runs.map((run, i) => (
        <section
          key={`${i}-${run.key}`}
          className="kit-sgames__run"
          aria-label={
            run.deck?.label ? `Played with ${run.deck.label}` : "Battles"
          }
        >
          {run.deck ? (
            <div className="kit-sgames__deck">
              <p className="kit-decklabel">
                {run.deck.label ? (
                  <b>
                    <TagText>{run.deck.label}</TagText>
                  </b>
                ) : (
                  <b>Deck</b>
                )}
                {` · ${run.games.length} ${noun(run.games.length, "battle")}`}
              </p>
              {oneDeckShown ? null : (
                <div className="kit-sgames__cards">
                  <DeckRow
                    cards={run.deck.cards}
                    showCost
                    label={`${run.deck.label ?? "The deck"}, its eight cards`}
                  />
                </div>
              )}
            </div>
          ) : null}
          <ol className="kit-sgames__list">
            {run.games.map((b) => (
              <Game
                key={b.battle_id}
                b={b}
                at={clock(b.at)}
                title={when(b.at)}
                showMode={manyModes}
              />
            ))}
          </ol>
        </section>
      ))}
      <div className="kit-sgames__foot">
        {offset > 0 ? (
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Newer battles
          </button>
        ) : null}
        {ev.next_offset !== null && ev.next_offset !== undefined ? (
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => setOffset(ev.next_offset)}
          >
            Older battles
          </button>
        ) : null}
        <p className="kit-sgames__note">
          {ev.completeness === "anchor_bound"
            ? "The start of this session may be missing. "
            : ""}
          Only battles Elixir recorded are here.
        </p>
      </div>
    </div>
  );
}

const RESULT = { win: "Win", loss: "Loss", draw: "Draw" };

function Who({ p }) {
  return (
    <Link to={playerHref(p.player_tag)} className="kit-sgame__name">
      <TagText>{nameOf(p)}</TagText>
    </Link>
  );
}

function Game({ b, at, title, showMode }) {
  const outcome = RESULT[b.outcome] ? b.outcome : "unknown";
  const score = gameScore(b);
  const trophies = trophyWord(b);
  const opponents = b.opponents ?? [];
  const mates = b.teammates ?? [];
  const url = b.url ? String(b.url).replace(/^https?:\/\/[^/]+/, "") : null;
  const duel = Array.isArray(b.games) && b.games.length > 0;
  return (
    <li className={`kit-sgame kit-sgame--${outcome}`}>
      <span className="kit-sgame__result">
        <b>{RESULT[b.outcome] ?? "Result unknown"}</b>
        {score ? <span className="kit-sgame__score">{score}</span> : null}
      </span>
      <span className="kit-sgame__body">
        <span className="kit-sgame__who">
          {mates.length ? (
            <>
              with{" "}
              {mates.map((p, i) => (
                <span key={p.player_tag}>
                  {i ? " and " : ""}
                  <Who p={p} />
                </span>
              ))}{" "}
            </>
          ) : null}
          {opponents.length ? (
            <>
              vs{" "}
              {opponents.map((p, i) => (
                <span key={p.player_tag}>
                  {i ? " and " : ""}
                  <Who p={p} />
                </span>
              ))}
            </>
          ) : (
            "Opponent not recorded"
          )}
        </span>
        <span className="kit-sgame__meta">
          <time dateTime={b.at} title={title}>
            {at}
          </time>
          {showMode && b.mode_group ? (
            <>
              {" · "}
              <span
                className={`mode-chip__dot mode-chip__dot--${b.mode_group}`}
                aria-hidden
              />{" "}
              {modeWord(b.mode_group)}
            </>
          ) : null}
          {mates.length === 0 && opponents[0]?.clan_name ? (
            <>
              {" · "}
              <TagText>{opponents[0].clan_name}</TagText>
            </>
          ) : null}
        </span>
        {duel ? (
          <ol className="kit-sgame__games" aria-label="The duel's games">
            {b.games.map((g) => (
              <li
                key={g.round}
                className={
                  g.outcome ? `kit-sgame__game--${g.outcome}` : undefined
                }
              >
                <span className="sr-only">
                  Game {g.round}
                  {g.outcome ? `, ${RESULT[g.outcome].toLowerCase()}` : ""}
                  :{" "}
                </span>
                {g.crowns ?? "?"}–{g.against ?? "?"}
              </li>
            ))}
          </ol>
        ) : null}
      </span>
      <span className="kit-sgame__end">
        {trophies ? (
          <span
            className={`kit-sgame__trophies${
              b.trophy_change > 0
                ? " kit-sgame__trophies--up"
                : b.trophy_change < 0
                  ? " kit-sgame__trophies--down"
                  : ""
            }`}
          >
            {trophies}
            <span className="sr-only"> trophies</span>
          </span>
        ) : null}
        {url ? (
          <Link to={url} className="kit-sgame__go">
            Battle<span className="sr-only"> at {at}</span>
          </Link>
        ) : null}
      </span>
    </li>
  );
}
