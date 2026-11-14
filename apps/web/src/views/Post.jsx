import { PlayerName } from "@elixir-mcp/ui";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { answered } from "../client/index.ts";
import {
  Avatar,
  DeckVersus,
  Icon,
  Link,
  MODE_LABEL,
  NavigateProvider,
  TagText,
  ZoneProvider,
  browserZone,
  useClock,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useMe, useNav } from "../App.jsx";
import {
  BattleView,
  DURATION,
  endedSentence,
  gamesOf,
  hpLeft,
  Invite,
  scoreOf,
} from "./Battle.jsx";
import { FollowFromHere } from "./FollowFromHere.jsx";

/**
 * A shared post, /h/<share id> (social slice 4, #762; DECISIONS
 * "Everyone signs in; shared posts stay public"). Opens without an
 * account: the owner's game name and words over the battle (canvas
 * Highlight, 2026-11-13): who won and the score, both decks with the score
 * between, four numbers side by side, and a way to the battle's own public
 * page, which has every number. Everything here is
 * /api/public/highlights/<id>, the one projection the preview tags and the
 * picture read too. A deleted post is "No post at this link".
 */
export function PostPage() {
  const { id } = useParams({ strict: false });
  const navigate = useNav();
  const { me } = useMe();
  const zone = me?.authenticated ? (me.timezone ?? null) : browserZone();
  const go = (to) =>
    to.startsWith("/battle/") || to.startsWith("/home/")
      ? navigate(to)
      : window.location.assign(to);
  return (
    <ZoneProvider zone={zone}>
      <NavigateProvider navigate={go}>
        <Post shareId={id} me={me} />
      </NavigateProvider>
    </ZoneProvider>
  );
}

export function Post({ shareId, me }) {
  const query = useQuery({
    queryKey: ["public", "post", shareId],
    queryFn: answered(() => api.publicPost(shareId)),
  });
  const read = query.data?.ok ? query.data.data : null;
  const h = read?.highlight ?? null;
  const who = h ? (h.name ?? h.player_tag) : null;
  const gone = query.isSuccess && !h;

  useEffect(() => {
    if (gone) document.title = "No post at this link - Elixir";
    else if (who) document.title = `${who} - Post - Elixir`;
  }, [who, gone]);

  if (query.isPending) return <p className="nil">Loading…</p>;
  if (query.isError)
    return (
      <div className="empty">
        <div className="empty__title">Elixir did not answer</div>
        <div className="empty__body">
          Try again in a minute.{" "}
          <button
            type="button"
            className="link"
            onClick={() => query.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  if (!h)
    return (
      <div className="empty">
        <div className="empty__title">No post at this link</div>
        <div className="empty__body">
          Nothing is shared under this link. Its owner may have deleted it.
        </div>
      </div>
    );
  return (
    <div className="kit-post">
      <PostCard read={read} h={h} who={who} viewer={me} />
      {/* The way in, or the Follow, sits under the post: its player first
          (#763), read from the post itself, never from who sent it. */}
      {me?.authenticated === false && <Invite who={who} />}
      {me?.authenticated === true && (
        <FollowFromHere sides={read.sides} me={me} first={h.player_tag} />
      )}
    </div>
  );
}

const nameOf = (p) => p?.name ?? p?.player_tag ?? "Unknown";
const namesOf = (side) => side.players.map(nameOf).join(" and ") || "Unknown";
const fixed = (n, d) => (typeof n === "number" ? n.toFixed(d) : "—");
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const VERB = { win: "beat", loss: "lost to", draw: "drew with" };

/** The post itself, from its player's side: theirs first. */
function PostCard({ read, h, who, viewer }) {
  const { when } = useClock();
  const { battle } = read;
  const games = gamesOf(read);
  const flip = h.side === "right";
  const [mine, theirs] = flip
    ? [read.sides[1], read.sides[0]]
    : [read.sides[0], read.sides[1]];
  const [me, them] = [mine.players[0] ?? {}, theirs.players[0] ?? {}];
  // The read's one score (games won, or crowns), from this side.
  const s = scoreOf(read, games);
  const score = flip ? [s.right, s.left] : [s.left, s.right];
  const said = score.map((n) => n ?? "?").join("-");
  const title = `${namesOf(mine)} ${VERB[mine.outcome] ?? "played"} ${namesOf(theirs)} ${said}`;
  const mode = MODE_LABEL[battle.mode_group] ?? battle.game_mode?.name ?? null;
  const decks =
    mine.players.length === 1 &&
    theirs.players.length === 1 &&
    me.deck?.cards?.length &&
    them.deck?.cards?.length;
  const nums = [
    [
      "Average elixir",
      fixed(me.deck?.average_elixir, 2),
      fixed(them.deck?.average_elixir, 2),
    ],
    ["Four cheapest", me.deck?.cycle4 ?? "—", them.deck?.cycle4 ?? "—"],
    ["Elixir leaked", fixed(me.elixir_leaked, 2), fixed(them.elixir_leaked, 2)],
    [
      "Tower hitpoints left",
      num(hpLeft(mine.tower_hp)),
      num(hpLeft(theirs.tower_hp)),
    ],
  ];
  const dur = games ? null : DURATION[battle.duration?.basis];
  const short = battle.short_id ?? battle.id;
  return (
    <article className="kit-post__card" aria-label={`${who}’s post`}>
      <header className="kit-feed__head">
        <Avatar name={who} tag={h.player_tag} card={h.avatar_card_id ?? null} />
        <div className="kit-feed__who">
          <span className="kit-feed__name">
            <PlayerName tag={h.player_tag}>
              <TagText>{who}</TagText>
            </PlayerName>
          </span>
          <span className="kit-feed__time">
            {[
              h.created_at ? `highlighted ${when(h.created_at)}` : null,
              [mode, battle.battle_time ? when(battle.battle_time) : null]
                .filter(Boolean)
                .join(", "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </header>
      <h1 className="kit-post__title">
        <TagText>{title}</TagText>
      </h1>
      {h.words ? (
        <p className="kit-feed__words kit-post__words">{h.words}</p>
      ) : (
        <p className="kit-feed__sub">{who} highlighted this battle.</p>
      )}
      {decks ? (
        <DeckVersus
          left={{
            name: <TagText>{nameOf(me)}</TagText>,
            label: me.deck.label ?? null,
            cards: me.deck.cards,
          }}
          right={{
            name: <TagText>{nameOf(them)}</TagText>,
            label: them.deck.label ?? null,
            cards: them.deck.cards,
          }}
          score={said}
          scoreLabel={`${score[0] ?? "?"} to ${score[1] ?? "?"}${s.unit === "games" ? " games" : " crowns"}`}
        />
      ) : (
        // A duel reads game by game and a 2v2 has teammates: the battle's
        // own view draws those decks, as the post did before the canvas.
        <BattleView
          read={read}
          me={viewer}
          follow={false}
          invite={false}
          cheers={false}
          heading="h2"
        />
      )}
      {decks ? (
        <dl className="kit-nums">
          {nums.map(([k, a, b]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                {a}{" "}
                <span className="kit-nums__vs">
                  <span aria-hidden="true">v</span>
                  <span className="kit-vs__said">against</span> {b}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {decks && dur ? (
        <p className="kit-tiny kit-post__length">
          <Icon name="timer" size={14} />
          <span>
            {dur.sub}.{" "}
            <TagText>
              {endedSentence(battle.duration.basis, read.sides)}
            </TagText>
          </span>
        </p>
      ) : null}
      <footer className="kit-feed__foot">
        <span className="share-actions kit-feed__links">
          <Link to={`/battle/${short}`} className="btn btn--sm">
            The full battle
          </Link>
        </span>
      </footer>
    </article>
  );
}
