import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import {
  DeckRow,
  Empty,
  ErrorState,
  Icon,
  Link,
  PageHead,
  PlayerName,
  Skeleton,
  TagText,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { sessionPostText } from "@elixir-mcp/ui/session-story";
import { useMe } from "../App.jsx";
import { playerHref } from "../lib/player.js";
import { usePlayerSession } from "../lib/queries.js";
import { tagFromPath } from "../lib/tag-url.js";
import { sessionChips, sessionHeadline, trophyNet } from "./Session.jsx";
import { Cheers, usePageCheered } from "./Cheers.jsx";
import { Comments } from "./Comments.jsx";
import { Game } from "./SessionGames.jsx";
import { Sparkline } from "./Sparkline.jsx";
import { gameMarks } from "./session-games.js";
import { FollowFromHere } from "../views/FollowFromHere.jsx";
import { CopyButton, Invite, JoinLine } from "../views/JoinElixir.jsx";

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
 *
 * Its public page (2026-11-17) is /session/<tag>/<id>/<start>
 * (PublicSession.jsx): the same view read as nobody. Signed out, this
 * address goes there (App.jsx HomeOutlet, and the web API's 302 on a
 * first load).
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
  const queryClient = useQueryClient();
  const { me } = useMe();
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
  if (query.isPending) return <Skeleton rows={4} label="Reading the session" />;
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
            onClick={() => {
              // Every page of this session is stale now, the first one
              // included: read it again rather than serve the cached copy
              // whose version the server just refused.
              queryClient.invalidateQueries({
                queryKey: ["me", "player-session"],
              });
              setPage({ offset: 0, version: null });
            }}
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
      me={me}
      busy={query.isFetching}
      onPage={(offset) =>
        setPage({ offset, version: env.data.item?.evidence?.version ?? null })
      }
    />
  );
}

/** The page, for a member or (`publicView`) for anyone with the link:
 *  then no comments, no highlight and no links into the signed-in app,
 *  names as the game spells them, and the way in for a reader with no
 *  account. `me` is the signed-in reader, for Follow from here. */
export function SessionView({
  data,
  busy,
  onPage,
  publicView = false,
  me = null,
}) {
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
  // A deck's count over the whole session, when the read says it (a
  // session longer than one page of games, 2026-11-17).
  const whole = (d) => (Number.isInteger(d.battles) ? d.battles : null);
  const playedOn = (d) => battles.filter((b) => decks[b.deck] === d).length;
  own.sort((a, b) => (whole(b) ?? playedOn(b)) - (whole(a) ?? playedOn(a)));
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
            {publicView ? (
              <span>
                <TagText>{name}</TagText>
              </span>
            ) : (
              <Link to={playerHref(player.tag)} className="kit-back">
                <Icon name="chevron-left" size={16} />
                <PlayerName tag={player.tag}>
                  <TagText>{name}</TagText>
                </PlayerName>
              </Link>
            )}
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

      {publicView ? <JoinLine /> : null}

      {item.id && !publicView ? (
        <SessionCheers item={item} tag={player.tag} />
      ) : null}

      {item.id && !publicView ? (
        // Comments on the session's item (2026-11-16), read when opened:
        // only while it is in your own feed, as on Home.
        <Comments it={{ ...item, cheer_subjects: [player.tag] }} />
      ) : null}

      {own.length ? (
        <section className="kit-session__decks" aria-labelledby="s-decks">
          <h2 id="s-decks" className="kit-session__h">
            {own.length === 1 ? "The deck" : "The decks"}
          </h2>
          {own.map((d, i) => {
            // The update counts by archetype; two decks under one label
            // each say their own count from the games on this page.
            const shared = own.filter((o) => o.label === d.label).length > 1;
            const n =
              whole(d) ??
              (shared ? playedOn(d) : (counted.get(d.label) ?? playedOn(d)));
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
                    !publicView && you?.can_highlight && url
                      ? `${url}#highlight`
                      : null
                  }
                  linked={!publicView}
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

      {!publicView && you && !you.own ? (
        <FollowFromHere
          sides={[{ players: [{ player_tag: player.tag, name: player.name }] }]}
          me={me}
        />
      ) : null}

      {publicView ? <Invite who={name} /> : null}

      <SessionShare data={data} name={name} />
    </div>
  );
}

/** Cheers on a session's page (2026-11-17): the item takes your cheer
 *  here as on the Timeline, only while it is in your own feed (the player
 *  page's cheers read says so); otherwise nothing is drawn. */
function SessionCheers({ item, tag }) {
  const cheered = usePageCheered({ player: tag });
  const it = cheered.of(item);
  return it ? (
    <div className="kit-session__cheers">
      <Cheers it={it} where={cheered.where} />
    </div>
  ) : null;
}

/** Share this session (2026-11-17), as a battle's page shares: its public
 *  link, its picture, and a line for a post. Only for a sitting anyone
 *  with the link may read; the read leaves `url` empty otherwise. */
function SessionShare({ data, name }) {
  if (!data.url) return null;
  const post = sessionPostText(
    data.player?.name ?? name,
    data.item?.facts,
    data.url,
  );
  return (
    <section className="panel" aria-label="Share this session">
      <div className="panel__head">Share this session</div>
      <div className="panel__body">
        <div className="share-link">
          <Icon name="link-2" size={15} />
          <span className="share-link__url">{data.url}</span>
          <CopyButton
            text={data.url}
            label="Copy link"
            className="btn btn--sm btn--gold"
          />
        </div>
        <div className="share-actions">
          {data.image ? (
            <a className="btn btn--sm" href={data.image} download>
              <Icon name="layers" size={15} />
              Share image
            </a>
          ) : null}
          <CopyButton text={post} label="Copy for a post" />
        </div>
        <p className="footnote">
          Anyone with the link can open this page, no account needed: the
          session’s battles, the decks, and the players’ game names. It stays up
          for 30 days.
        </p>
      </div>
    </section>
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
