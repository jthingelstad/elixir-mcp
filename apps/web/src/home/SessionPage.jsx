import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  DeckRow,
  Empty,
  ErrorState,
  Link,
  PageHead,
  PlayerName,
  TagText,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { playerHref } from "../lib/player.js";
import { usePlayerSession } from "../lib/queries.js";
import { tagFromPath } from "../lib/tag-url.js";
import { sessionChips, sessionHeadline, trophyNet } from "./Session.jsx";
import { Game } from "./SessionGames.jsx";
import { Sparkline } from "./Sparkline.jsx";
import { gameMarks } from "./session-games.js";

/**
 * A session's own page (2026-11-16): what a run's page is on Strava. Its
 * address is the player's page plus the session's id
 * (`/home/player/<tag>/session/<id>?at=<start>`), so a card, the bell, a
 * Discord line or the digest can link it and Back returns where you were.
 *
 * The summary (its figures, the strip of its battles, the facts worth a
 * chip), the decks played with their art, then every game newest first: the
 * result and crowns, who was on the other side and their deck, the
 * trophies, mode and time, and the battle's own page. Games that mattered
 * say so in facts ("5th win in a row", "Three crowns", a new best), never
 * as a rating. The reader's own verified player can highlight a game one
 * tap from its row. Where the record and the update's count differ, the
 * page says so in plain words.
 */
export function SessionPage() {
  const { pathname, search } = useLocation();
  const parts = pathname.replace(/\/$/, "").split("/");
  const tag = tagFromPath(parts[3] ?? "");
  let id = "";
  try {
    id = decodeURIComponent(parts[5] ?? "");
  } catch {
    id = "";
  }
  const at = typeof search?.at === "string" ? search.at : null;
  const [page, setPage] = useState({ offset: 0, version: null });
  const query = usePlayerSession(
    tag && id
      ? {
          tag,
          id,
          ...(at ? { at } : {}),
          ...(page.offset
            ? {
                offset: String(page.offset),
                expected_evidence_version: page.version,
              }
            : {}),
        }
      : null,
  );
  if (!tag || !id) return <Empty title="That is not a session’s address" />;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || (query.data && query.data.status >= 500))
    return (
      <ErrorState
        title="This session could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  const env = query.data;
  if (env.status === 429)
    return (
      <Empty title="Elixir is busy for you just now">
        {env.data?.message ?? "Try again in a little while."}
      </Empty>
    );
  if (env.status === 409)
    return (
      <Empty
        title="These games changed since the page was read"
        action={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setPage({ offset: 0, version: null })}
          >
            Read them again
          </button>
        }
      >
        A battle was recorded after this page was read.
      </Empty>
    );
  if (env.status !== 200)
    return (
      <Empty
        title="Elixir has no record of this session"
        action={
          <Link to={playerHref(tag)} className="btn btn--sm">
            Open the player’s page
          </Link>
        }
      >
        A session older than 30 days drops off, and an address with a typo finds
        nothing.
      </Empty>
    );
  return (
    <SessionView
      data={env.data}
      busy={query.isFetching}
      onPage={(offset) =>
        setPage({ offset, version: env.data.item?.evidence?.version ?? null })
      }
    />
  );
}

function SessionView({ data, busy, onPage }) {
  const { when, clock, feedWhen } = useClock();
  const { player, item, games, you } = data;
  const f = item.facts ?? {};
  const net = trophyNet(f);
  const chips = sessionChips(f, item.scores);
  const battles = games.battles ?? [];
  const decks = games.decks ?? [];
  const name = player.name ?? player.tag;
  // The player's own decks on this page, most battles first; a deck the
  // update counted names its count from the update.
  const own = [...new Set(battles.map((b) => b.deck).filter(Number.isInteger))]
    .map((i) => decks[i])
    .filter((d) => d?.cards?.length);
  const counted = new Map((f.decks ?? []).map((d) => [d.label, d.battles]));
  const playedOn = (d) => battles.filter((b) => decks[b.deck] === d).length;
  own.sort((a, b) => playedOn(b) - playedOn(a));
  const manyDecks = own.length > 1 || (f.decks ?? []).length > 1;
  const manyModes = Object.keys(f.by_mode ?? {}).length > 1;
  const marks = gameMarks(battles, {
    spark: item.spark,
    count: games.count,
    offset: games.offset ?? 0,
    marks: data.marks ?? [],
  });
  const one = (f.battles ?? 0) === 1;
  const range =
    f.started_at && f.ended_at
      ? feedWhen(f.started_at, f.ended_at)
      : item.at
        ? feedWhen(item.at)
        : null;
  return (
    <div className="kit-session">
      <PageHead
        crumb={
          <div className="page__crumb">
            <Link to={playerHref(player.tag)}>
              ‹{" "}
              <PlayerName tag={player.tag}>
                <TagText>{name}</TagText>
              </PlayerName>
            </Link>
          </div>
        }
        title={sessionHeadline(f)}
        sub={
          range ? (
            <time
              dateTime={f.started_at ?? item.at}
              title={
                f.started_at && f.ended_at
                  ? `${when(f.started_at)} to ${when(f.ended_at)}`
                  : when(item.at)
              }
            >
              {range}
            </time>
          ) : null
        }
      />

      <section className="kit-session__summary" aria-label="Summary">
        <dl className="kit-sfacts">
          <div>
            <dt>Battles</dt>
            <dd>{f.battles ?? 0}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd className="kit-sfacts--won">{f.won ?? 0}</dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd>{f.lost ?? 0}</dd>
          </div>
          {(f.drawn ?? 0) > 0 ? (
            <div>
              <dt>Drawn</dt>
              <dd>{f.drawn}</dd>
            </div>
          ) : null}
          {net !== null ? (
            <div>
              <dt>Trophies</dt>
              <dd
                className={
                  net > 0 ? "kit-sfacts--up" : net < 0 ? "kit-sfacts--down" : ""
                }
              >
                {net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : "0"}
              </dd>
            </div>
          ) : null}
        </dl>
        {one ? null : <Sparkline spark={item.spark} />}
        {chips.length ? (
          <ul className="kit-scard__chips" aria-label="Facts">
            {chips.map((c) => (
              <li key={c.key} className="chip">
                {c.text}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {own.length ? (
        <section className="kit-session__decks" aria-labelledby="s-decks">
          <h2 id="s-decks" className="kit-session__h">
            {own.length === 1 ? "The deck" : "The decks"}
          </h2>
          {own.map((d, i) => {
            const n = counted.get(d.label) ?? playedOn(d);
            return (
              <div key={`${d.label}-${i}`} className="kit-session__deck">
                <p className="kit-decklabel">
                  <b>
                    <TagText>{d.label ?? "Deck"}</TagText>
                  </b>
                  {` · ${n} ${noun(n, "battle")}`}
                </p>
                <DeckRow
                  cards={d.cards}
                  showCost
                  label={`${d.label ?? "The deck"}, its eight cards`}
                />
              </div>
            );
          })}
        </section>
      ) : null}

      <section
        className="kit-session__games"
        aria-labelledby="s-games"
        aria-busy={busy}
      >
        <h2 id="s-games" className="kit-session__h">
          {games.count} {noun(games.count, "battle")}
          <span className="kit-session__hnote"> · newest first</span>
          {games.open ? (
            <span className="chip chip--ok">Still playing</span>
          ) : null}
        </h2>
        <Honesty item={item} games={games} />
        {battles.length === 0 ? (
          <p className="kit-sgames__note">No battles recorded on this page.</p>
        ) : (
          <ol className="kit-sgames__list kit-session__list">
            {battles.map((b) => {
              const url = b.url
                ? String(b.url).replace(/^https?:\/\/[^/]+/, "")
                : null;
              return (
                <Game
                  key={b.battle_id}
                  b={b}
                  at={clock(b.at)}
                  title={when(b.at)}
                  showMode={manyModes}
                  theirs={
                    Number.isInteger(b.opponent_deck)
                      ? decks[b.opponent_deck]
                      : null
                  }
                  mine={
                    manyDecks && Number.isInteger(b.deck) ? decks[b.deck] : null
                  }
                  marks={marks.get(b.battle_id) ?? []}
                  highlightTo={
                    you?.can_highlight && url ? `${url}#highlight` : null
                  }
                />
              );
            })}
          </ol>
        )}
        <div className="kit-sgames__foot">
          {(games.offset ?? 0) > 0 ? (
            <button
              className="btn btn--sm"
              type="button"
              onClick={() => onPage(Math.max(0, games.offset - 25))}
            >
              Newer battles
            </button>
          ) : null}
          {games.next_offset !== null && games.next_offset !== undefined ? (
            <button
              className="btn btn--sm"
              type="button"
              onClick={() => onPage(games.next_offset)}
            >
              Older battles
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** What the record holds against what the update counted, in plain words
 *  (2026-11-16): the two can differ, and the page never hides it. */
function Honesty({ item, games }) {
  const counted = item.facts?.battles;
  const lines = [];
  if (typeof counted === "number" && counted !== games.count)
    lines.push(
      games.count < counted
        ? `The update counted ${counted} ${noun(counted, "battle")}. Elixir recorded ${games.count} of them, so ${counted - games.count} ${noun(counted - games.count, "is", "are")} not shown here.`
        : `The update counted ${counted} ${noun(counted, "battle")}. Elixir has recorded ${games.count} since, and all of them are here.`,
    );
  if (item.kind === "session_standout")
    lines.push(
      "These end at the milestone the update names. Later battles in the same session aren’t here.",
    );
  if (games.completeness === "anchor_bound")
    lines.push("The start of this session may be missing.");
  lines.push(
    "Only battles Elixir recorded are here: a battle the game played but Elixir never read is missing.",
  );
  return (
    <div className="kit-session__honest">
      {lines.map((l) => (
        <p key={l} className="kit-sgames__note">
          {l}
        </p>
      ))}
    </div>
  );
}
