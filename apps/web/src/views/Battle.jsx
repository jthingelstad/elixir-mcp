import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { answered } from "@elixir-mcp/client";
import {
  DeckGrid,
  MODE_LABEL,
  Icon,
  Link,
  NavigateProvider,
  browserZone,
  ZoneProvider,
  cardLabel,
  isTowerTroop,
  TagText,
  Tabs,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useMe, useNav } from "../App.jsx";
import { playerHref } from "../lib/player.js";
import { statsPlayers } from "../stats/stats.js";
import { BattleCheers } from "./BattleCheers.jsx";
import { BattleHighlight } from "./BattleHighlight.jsx";
import { FollowFromHere } from "./FollowFromHere.jsx";
import { PlayerBattleShare } from "./PlayerBattleShare.jsx";

/**
 * One battle's public page, /battle/<short id> (design canvas
 * 2026-10-01; Jamie: "Public yes. Left is the player right is
 * opponent."). Sign-in free: anyone with the link reads both decks, how
 * it ended and the players' game names. Everything here is what
 * /api/public/battles/<ref> returns - one projection that the preview
 * tags and the share image read too - so the page never derives a
 * number the record does not hold.
 */

const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const fixed = (n, d) => (typeof n === "number" ? n.toFixed(d) : "—");

/** A link Elixir hands out is absolute; inside the app it is a path, so
 *  a click on another battle stays in the page. */
const pathOf = (url) => String(url ?? "").replace(/^https?:\/\/[^/]+/, "");

/** The game's own copy-deck link: it opens Clash Royale with the deck
 *  ready to save ("The share buttons are actually 'copy deck'
 *  buttons", Jamie). Cards in the order played; the tower troop rides
 *  as `tt` when the battle recorded one. */
export function copyDeckUrl(deck) {
  if (!deck?.cards?.length) return null;
  const ids = deck.cards.map((c) => c.id).join(";");
  const tt = deck.tower_troop?.id ? `&tt=${deck.tower_troop.id}` : "";
  return `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${ids}${tt}`;
}

// A nameless player is named by tag; where a name is drawn it goes
// through TagText, so that tag reads with a slashed zero.
const nameOf = (p) => p?.name ?? p?.player_tag ?? "Unknown";
const namesOf = (side) => side.players.map(nameOf).join(" and ") || "Unknown";

/** Towers as tiles, laid out as the arena has them (Jamie, 2026-11-13):
 *  a Princess Tower, the King Tower in the middle, the other Princess
 *  Tower. The Princess Towers keep the order the game reports them, the
 *  first on the left (never a lane: position carries none). A side whose
 *  record lacks a value still draws all three slots, the missing one as
 *  not recorded, so the King always sits in the middle. */
function towersOf(hp) {
  if (!hp) return null;
  const p = hp.princess ?? [];
  return [
    { kind: "Princess", hp: p[0] ?? null },
    { kind: "King", hp: hp.king ?? null },
    { kind: "Princess", hp: p[1] ?? null },
  ];
}
export const hpLeft = (hp) => {
  const t = towersOf(hp);
  return t ? t.reduce((a, x) => a + (x.hp ?? 0), 0) : null;
};
const princessLost = (hp) => (hp?.princess ?? []).filter((v) => v === 0).length;

/** What the crown pair proves about the length (inferred.duration). */
export const DURATION = {
  king_tower_fell: {
    sub: "A King Tower fell, inside 5:00",
    chip: "5:00 or less",
  },
  regulation_ran: { sub: "Went to time, 3:00 to 5:00", chip: "3:00 to 5:00" },
  overtime_expired: { sub: "Overtime ran out at 5:00", chip: "5:00" },
};

const TOWER_WORDS = ["none", "one", "both"];

/** The factual sentence under "How it ended": only what the towers and
 *  the crowns say, never why. */
export function endedSentence(basis, sides) {
  const [l, r] = sides;
  const out = [];
  if (basis === "king_tower_fell") {
    const winner = l.outcome === "win" ? l : r;
    out.push(`${namesOf(winner)} took the King Tower for three crowns.`);
  } else if (basis === "regulation_ran") {
    const down = princessLost(l.tower_hp) + princessLost(r.tower_hp);
    out.push(
      `The game went to time with ${down === 1 ? "one tower" : `${down} towers`} down.`,
    );
  } else if (basis === "overtime_expired") {
    out.push(
      l.outcome === "draw"
        ? "Overtime ran out with the crowns level: a draw."
        : "Overtime ran out with the crowns level, and the tiebreaker - the side whose weakest tower stood higher - decided it.",
    );
  }
  for (const s of sides) {
    if (!s.tower_hp || s.tower_hp.king === 0) continue;
    const lost = princessLost(s.tower_hp);
    out.push(
      lost === 0
        ? `${namesOf(s)} kept both Princess Towers.`
        : `${namesOf(s)} lost ${TOWER_WORDS[lost]} Princess Tower${lost === 1 ? "" : "s"}.`,
    );
  }
  return out.join(" ");
}

/** True while the page is narrower than a phone in landscape: the decks
 *  draw smaller there so both still sit side by side. */
function useMedia(query) {
  const [hit, setHit] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq?.addEventListener) return;
    const on = (e) => setHit(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return hit;
}

function CopyButton({ text, label = "Copy", className = "btn btn--sm" }) {
  const [copied, flash] = useFlash();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        flash();
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : label}
    </button>
  );
}

/** /battle/<ref>: the page, on the reader's clock (the account's zone,
 *  or the browser's when nobody is signed in). A signed-in account with
 *  no zone set reads UTC here as it does on the Console and Ladder, so
 *  one battle never shows two clocks. Links to the site's static pages
 *  (a card) are page loads; another battle stays in-app. */
export function BattlePage() {
  const { ref } = useParams({ strict: false });
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
        <Battle battleRef={ref} me={me} />
      </NavigateProvider>
    </ZoneProvider>
  );
}

/** `standIn`: `me` stands in for another viewer (Settings › What members
 *  see draws this page as a member or a link holder would), so nothing
 *  that reads the real reader's own things is drawn. */
export function Battle({ battleRef, me, standIn = false }) {
  const query = useQuery({
    queryKey: ["public", "battle", battleRef],
    queryFn: answered(() => api.publicBattle(battleRef)),
  });
  const env = query.data;
  // A 300 is an answer too: a hand-cut prefix two battles share.
  const read = env?.ok || env?.status === 300 ? env.data : null;

  const answeredNone = query.isSuccess && !read;
  useEffect(() => {
    if (answeredNone) document.title = "No battle at this link - Elixir";
    if (!read?.sides) return;
    const [l, r] = read.sides;
    document.title = `${namesOf(l)} and ${namesOf(r)} - Battle - Elixir`;
  }, [read, answeredNone]);

  if (query.isPending) return <p className="nil">Loading…</p>;
  if (query.isError)
    return (
      <Empty title="Elixir did not answer">
        Try again in a minute.{" "}
        <button type="button" className="link" onClick={() => query.refetch()}>
          Retry
        </button>
      </Empty>
    );
  if (!read)
    return (
      <Empty title="No battle at this link">
        Elixir holds no recorded battle under this id. A link from Elixir names
        a battle it has recorded; a battle played in the last few minutes may
        not have been read yet.
      </Empty>
    );
  if (read.matches)
    return (
      <Empty title="This short id names more than one battle">
        <ul>
          {read.matches.map((url) => (
            <li key={url}>
              <Link to={pathOf(url)}>{url}</Link>
            </li>
          ))}
        </ul>
      </Empty>
    );
  return <BattleView read={read} me={me} standIn={standIn} />;
}

function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      <div className="empty__body">{children}</div>
    </div>
  );
}

/** `follow` and `invite` let a page that wraps the battle (a shared post)
 *  draw its own Follow suggestions and its own way in, above it; `cheers`
 *  off leaves the cheers to the battle's own page.
 *  `standIn` draws the page as somebody else sees it (Settings' lens):
 *  none of the reader's own controls. `heading` names the battle's title
 *  tag when another page already has the h1. */
export function BattleView({
  read,
  me,
  follow = true,
  invite = true,
  cheers = true,
  standIn = false,
  heading = standIn ? "h3" : "h1",
}) {
  const { battle, sides } = read;
  const games = gamesOf(read);
  const clock = useClock();
  const narrow = useMedia("(max-width: 760px)");
  const [game, setGame] = useState(0);
  const mine = new Set((me?.claims ?? []).map((c) => c.player_tag));
  const signedIn = me?.authenticated === true;
  const signedOut = me?.authenticated === false;
  const mode = MODE_LABEL[battle.mode_group] ?? battle.game_mode?.name ?? null;
  const when = clock.when(battle.battle_time);
  const [l, r] = sides;
  const g = games?.[game] ?? null;
  // A duel reads game by game: its decks, towers and leak are the
  // selected game's; the crowns at the top are the games won.
  const shown = g
    ? sides.map((s, i) => ({ ...s, tower_hp: g.sides[i]?.tower_hp ?? null }))
    : sides;

  return (
    <article className="battle" aria-labelledby="battle-result">
      <div className="battle__bar">
        {mode && (
          <span className="mode-chip">
            <span
              className={`mode-chip__dot mode-chip__dot--${battle.mode_group}`}
            />
            {mode}
            {battle.kind === "duel" ? " · duel" : ""}
            {battle.kind === "2v2" ? " · 2v2" : ""}
          </span>
        )}
        {battle.arena?.name && (
          <span className="battle__fact">
            <Icon name="castle" size={15} />
            {battle.arena.name}
          </span>
        )}
        <span className="battle__fact">
          <Icon name="clock" size={15} />
          <time dateTime={battle.battle_time}>{when}</time>
        </span>
        <span className="battle__bar-spacer" />
        {battle.url && <CopyButton text={battle.url} label="Copy link" />}
      </div>

      <Scoreboard
        battle={battle}
        sides={sides}
        games={games}
        score={read.score}
        mine={mine}
        signedIn={signedIn}
        mode={mode}
        when={when}
        // Drawn inside another page (a stand-in lens, a shared post), the
        // battle is a section under that page's heading, never a second h1.
        heading={heading}
      />

      {games && (
        // The kit's one tab row (2026-11-13), not a third tab style: the
        // games are tabs like a player's or a clan's.
        <Tabs
          label="Games"
          className="battle__games"
          value={String(game)}
          onSelect={(k) => setGame(Number(k))}
          items={games.map((x, i) => ({
            key: String(i),
            label: `Game ${x.round}${
              typeof x.sides[0]?.crowns === "number" &&
              typeof x.sides[1]?.crowns === "number"
                ? ` · ${x.sides[0].crowns}–${x.sides[1].crowns}`
                : ""
            }`,
          }))}
        />
      )}

      <div className="battle__grid battle__grid--decks">
        {interleave(l.players, r.players).map(({ p, side }) => (
          <DeckPanel
            key={`${side}-${p.player_tag}`}
            player={p}
            outcome={sides[side].outcome}
            deck={g ? (p.rounds?.[game] ?? null) : p.deck}
            narrow={narrow}
          />
        ))}
      </div>

      {battle.kind === "1v1" ? (
        <div className="battle__grid battle__grid--wide">
          <Ended battle={battle} sides={shown} title="How it ended" />
          <SideBySide battle={battle} sides={sides} />
        </div>
      ) : (
        <Ended
          battle={battle}
          sides={shown}
          game={g}
          title={g ? `How game ${g.round} ended` : "How it ended"}
        />
      )}

      {signedIn && !standIn && (
        <BattleHighlight battle={battle} sides={sides} />
      )}

      {signedIn && cheers && !standIn && <BattleCheers battle={battle} />}

      {signedIn && follow && !standIn && (
        <FollowFromHere sides={sides} me={me} />
      )}

      {signedOut && invite && <Invite />}

      <div className="battle__grid battle__grid--three">
        <Meetings read={read} />
        <Sitting read={read} />
        <Share
          battle={battle}
          sides={sides}
          own={
            signedIn &&
            statsPlayers(me?.claims).some((p) =>
              sides.some((side) =>
                side.players.some((x) => x.player_tag === p.player_tag),
              ),
            )
          }
        />
      </div>

      <div className="battle__foot">
        <span>
          Battle <span className="battle__id">{battle.id}</span>
        </span>
      </div>
    </article>
  );
}

/** A duel's games. The read sends them (one per round deck, a result
 *  where the record holds one); a read cached from before it did, for a
 *  duel whose type is not a river race duel, sent none, so the games are
 *  the round decks the players carry, with no result. */
export function gamesOf(read) {
  if (read.games) return read.games;
  const n = Math.max(
    0,
    ...read.sides.flatMap((s) => s.players.map((p) => p.rounds?.length ?? 0)),
  );
  if (n === 0) return null;
  return Array.from({ length: n }, (_, i) => ({
    round: i + 1,
    winner: null,
    sides: [null, null],
  }));
}

/** The score the page leads with: the read's own (battle-page.mjs
 *  scoreOf), or for a read cached from before it carried one, the games
 *  won on a duel whose games all have a result, else the crowns. */
export function scoreOf(read, games) {
  if (read.score) return read.score;
  const [l, r] = read.sides;
  if (games?.length && games.every((g) => g.winner)) {
    const won = (w) => games.filter((g) => g.winner === w).length;
    return { left: won("left"), right: won("right"), unit: "games" };
  }
  return { left: l.crowns ?? null, right: r.crowns ?? null, unit: "crowns" };
}

/** Left then right, player by player: in a 2v2 each row of the grid is
 *  one player from each team. */
function interleave(left, right) {
  const out = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]) out.push({ p: left[i], side: 0 });
    if (right[i]) out.push({ p: right[i], side: 1 });
  }
  return out;
}

function PlayerName({ p, signedIn }) {
  // A name opens the player page (#764), for a reader who can open it;
  // signed out it is just the name.
  return signedIn ? (
    <Link className="battle__name" to={playerHref(p.player_tag)}>
      <TagText>{nameOf(p)}</TagText>
    </Link>
  ) : (
    <span className="battle__name">
      <TagText>{nameOf(p)}</TagText>
    </span>
  );
}

/** The clan by name, unlinked: its record folded with the Console
 *  (2026-11-12), and the player's name opens their page. */
function ClanName({ p }) {
  if (!p.clan_tag) return <span className="battle__clan">No clan</span>;
  return (
    <span className="battle__clan">
      <TagText>{p.clan_name ?? p.clan_tag}</TagText>
    </span>
  );
}

/** Where they started, then what the battle moved: the order players
 *  read trophies in. Trophy Road only - elsewhere the count does not
 *  move. A ladder loss with no change is a loss on a trophy floor. */
function TrophyPills({ p, outcome, mode }) {
  if (mode !== "ladder" || typeof p.starting_trophies !== "number") return null;
  const change =
    p.trophy_change ?? (outcome === "loss" || outcome === "draw" ? 0 : null);
  const tone =
    change > 0 ? " trophy-pill--win" : change < 0 ? " trophy-pill--loss" : "";
  return (
    <span className="trophy-pills">
      <span className="trophy-pill" title="Trophies going in">
        {num(p.starting_trophies)}
      </span>
      {change !== null && (
        <span
          className={`trophy-pill trophy-pill--change${tone}`}
          title="Trophies won or lost, and where they ended"
        >
          <b>{change > 0 ? `+${change}` : change < 0 ? `−${-change}` : "0"}</b>
          <span>{num(p.starting_trophies + change)}</span>
        </span>
      )}
    </span>
  );
}

function SideBlock({ side, align, mine, signedIn, mode }) {
  return (
    <div
      className={`battle__side${align === "right" ? " battle__side--right" : ""}`}
    >
      {side.players.map((p) => (
        <div key={p.player_tag} className="battle__side">
          <span className="battle__who">
            <PlayerName p={p} signedIn={signedIn} />
            {mine.has(p.player_tag) && (
              <span className="chip chip--ok">you</span>
            )}
          </span>
          <ClanName p={p} />
          <TrophyPills p={p} outcome={side.outcome} mode={mode} />
          {mode === "ladder" &&
            side.outcome === "loss" &&
            p.trophy_change === null && (
              <span className="battle__note">
                On a trophy floor, so the loss cost nothing
              </span>
            )}
        </div>
      ))}
    </div>
  );
}

function Crown({ n, outcome }) {
  const tone =
    outcome === "win"
      ? " battle__crown--win"
      : outcome === "loss"
        ? " battle__crown--loss"
        : "";
  return (
    <span className={`battle__crown${tone}`}>
      <Icon name="crown" size={26} />
      {n ?? "?"}
    </span>
  );
}

function Scoreboard({
  battle,
  sides,
  games,
  score: given,
  mine,
  signedIn,
  mode,
  when,
  heading: Heading = "h1",
}) {
  const [l, r] = sides;
  const s = scoreOf({ sides, score: given }, games);
  const score = [s.left, s.right];
  const result =
    l.outcome === "win"
      ? { text: `${namesOf(l)} won`, cls: " result-chip--win" }
      : l.outcome === "loss"
        ? { text: `${namesOf(r)} won`, cls: " result-chip--loss" }
        : { text: "Draw", cls: "" };
  const verb =
    l.outcome === "win"
      ? "beat"
      : l.outcome === "loss"
        ? "lost to"
        : "drew with";
  const unit = s.unit === "games" ? " games" : "";
  const dur = DURATION[battle.duration?.basis];
  return (
    <section className="battle__score" aria-labelledby="battle-result">
      <Heading id="battle-result" className="sr-only">
        {namesOf(l)} {verb} {namesOf(r)} {score[0]} to {score[1]}
        {unit}
        {mode ? ` on ${mode}` : ""}, {when}
      </Heading>
      <SideBlock
        side={l}
        align="left"
        mine={mine}
        signedIn={signedIn}
        mode={battle.mode_group}
      />
      <div className="battle__mid">
        <div className="battle__crowns" aria-hidden="true">
          <Crown n={score[0]} outcome={l.outcome} />
          <span className="battle__dash">–</span>
          <Crown n={score[1]} outcome={r.outcome} />
        </div>
        <span className={`result-chip${result.cls}`}>
          <TagText>{result.text}</TagText>
        </span>
        {games && s.unit === "games" ? (
          <span className="battle__sub">
            games · crowns {l.crowns ?? "?"}–{r.crowns ?? "?"}
          </span>
        ) : games ? (
          <span className="battle__sub">crowns over {games.length} games</span>
        ) : dur ? (
          <span className="battle__sub battle__sub--length">
            <Icon name="timer" size={14} />
            {dur.sub}
          </span>
        ) : null}
      </div>
      <SideBlock
        side={r}
        align="right"
        mine={mine}
        signedIn={signedIn}
        mode={battle.mode_group}
      />
    </section>
  );
}

function DeckPanel({ player, outcome, deck, narrow }) {
  const name = nameOf(player);
  const copy = copyDeckUrl(deck);
  const dot =
    outcome === "loss"
      ? " battle-deck__dot--loss"
      : outcome === "win"
        ? ""
        : " battle-deck__dot--draw";
  return (
    <section className="panel battle-deck" aria-label={`${name}’s deck`}>
      <div className="panel__head">
        <span className="battle-deck__head">
          <span className={`battle-deck__dot${dot}`} />
          <TagText>{name}</TagText>’s deck
        </span>
        {copy && (
          <a
            className="btn btn--sm"
            href={copy}
            title="Opens Clash Royale with this deck ready to save"
            aria-label={`Copy ${name}’s deck into Clash Royale`}
          >
            <Icon name="copy" size={14} />
            <span className="battle-deck__copy-text">Copy deck</span>
          </a>
        )}
      </div>
      <div className="panel__body">
        {deck ? (
          <div className="battle-deck__body">
            <DeckGrid
              cards={deck.cards}
              size={narrow ? 34 : 72}
              label={`${name}’s deck`}
              cardTo={(c) =>
                isTowerTroop(c.id) ? undefined : `/cards/${c.id}/`
              }
            />
            <div className="battle-deck__facts">
              {deck.label && (
                <span className="battle-deck__label">{deck.label}</span>
              )}
              <dl className="battle-deck__stats">
                <div>
                  <dt>Average elixir</dt>
                  <dd>{fixed(deck.average_elixir, 2)}</dd>
                </div>
                <div>
                  <dt>Cost of the four cheapest cards</dt>
                  <dd>{deck.cycle4 ?? "—"}</dd>
                </div>
                <div>
                  <dt>Card level</dt>
                  <dd>{fixed(deck.average_level, 1)}</dd>
                </div>
              </dl>
              {deck.tower_troop && (
                <span className="tower-troop">
                  <span className="tower-troop__text">
                    <span className="tower-troop__label">Tower troop</span>
                    <span>
                      {cardLabel(deck.tower_troop)}
                      {deck.tower_troop.level
                        ? ` · ${deck.tower_troop.level}`
                        : ""}
                    </span>
                  </span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="nil">The record holds no deck for this side.</p>
        )}
      </div>
    </section>
  );
}

function Towers({ hp }) {
  const tiles = towersOf(hp);
  if (!tiles) return <p className="nil">The game did not report the towers.</p>;
  return (
    <div className="towers">
      {tiles.map((t, i) => (
        <div
          key={`${t.kind}-${i}`}
          className={`tower${t.kind === "King" ? " tower--king" : ""}${t.hp === 0 ? " tower--down" : ""}`}
        >
          <span className="tower__kind">{t.kind} Tower</span>
          <span className="tower__hp">
            {t.hp === 0 ? "destroyed" : num(t.hp)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Ended({ battle, sides, game, title }) {
  const basis = game ? null : battle.duration?.basis;
  const dur = DURATION[basis];
  const sentence = game ? null : endedSentence(basis, sides);
  const noResult = game && !game.sides[0] && !game.sides[1];
  return (
    <section className="panel" aria-label={title}>
      <div className="panel__head">
        <span className="battle-deck__head">{title}</span>
        {dur && (
          <span className="chip">
            <Icon name="timer" size={12} />
            {dur.chip}
          </span>
        )}
      </div>
      <div className="panel__body battle-ended">
        {sentence && (
          <p>
            <TagText>{sentence}</TagText>
          </p>
        )}
        {noResult && (
          <p className="nil">The record holds no result for this game.</p>
        )}
        {!noResult &&
          sides.map((s, i) => {
            const left = hpLeft(s.tower_hp);
            const leak = game
              ? game.sides[i]?.elixir_leaked
              : s.players.length === 1
                ? s.players[0].elixir_leaked
                : null;
            return (
              <div key={i} className="battle-ended">
                <span className="battle-ended__who">
                  <span
                    className={`battle-deck__dot${s.outcome === "loss" ? " battle-deck__dot--loss" : s.outcome === "win" ? "" : " battle-deck__dot--draw"}`}
                  />
                  <TagText>{namesOf(s)}</TagText>
                  {left !== null && (
                    <span className="battle-ended__left">
                      <span className="mono-num">{num(left)}</span> hitpoints
                      left
                      {game && typeof leak === "number"
                        ? ` · ${fixed(leak, 2)} elixir leaked`
                        : ""}
                    </span>
                  )}
                </span>
                <Towers hp={s.tower_hp} />
              </div>
            );
          })}
      </div>
      <div className="panel__note">
        {basis === "regulation_ran" &&
          "A game that runs to time lasts between 3:00 and 5:00; whether it reached overtime is not recorded. "}
        Princess Towers are listed in the order the game reports them, not by
        lane.
        {game &&
          " A King Tower shows as destroyed when the other side took three crowns in that game, since the game leaves its value out."}
      </div>
    </section>
  );
}

function SideBySide({ battle, sides }) {
  const [l, r] = sides.map((s) => s.players[0] ?? {});
  const edge = battle.deck_level_edge;
  const level = (p, sign) => (
    <>
      <span className="mono-num">{fixed(p.deck?.average_level, 1)}</span>
      {typeof edge === "number" && edge * sign > 0 && (
        <span className="battle__note"> +{fixed(Math.abs(edge), 2)}</span>
      )}
    </>
  );
  const trophies = (p) =>
    typeof p.starting_trophies === "number"
      ? `${num(p.starting_trophies)} → ${num(p.starting_trophies + (p.trophy_change ?? 0))}`
      : "—";
  const troop = (p) =>
    p.deck?.tower_troop
      ? `${cardLabel(p.deck.tower_troop)} ${p.deck.tower_troop.level ?? ""}`.trim()
      : "—";
  const rows = [
    ["Crowns", sides[0].crowns ?? "—", sides[1].crowns ?? "—"],
    ...(battle.mode_group === "ladder"
      ? [["Trophies", trophies(l), trophies(r)]]
      : []),
    ["Average card level", level(l, 1), level(r, -1)],
    [
      "Average elixir",
      fixed(l.deck?.average_elixir, 2),
      fixed(r.deck?.average_elixir, 2),
    ],
    [
      "Cost of the four cheapest cards",
      l.deck?.cycle4 ?? "—",
      r.deck?.cycle4 ?? "—",
    ],
    ["Tower troop", troop(l), troop(r)],
    [
      "Tower hitpoints left",
      num(hpLeft(sides[0].tower_hp)),
      num(hpLeft(sides[1].tower_hp)),
    ],
    ["Elixir leaked", fixed(l.elixir_leaked, 2), fixed(r.elixir_leaked, 2)],
  ];
  return (
    <section className="panel battle__compare" aria-label="Side by side">
      <div className="panel__head">Side by side</div>
      <div className="table__scroll" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <td />
              <th scope="col" className="num">
                <TagText>{nameOf(l)}</TagText>
              </th>
              <th scope="col" className="num">
                <TagText>{nameOf(r)}</TagText>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k}>
                <td className="battle__measure">{k}</td>
                <td className="num">{a}</td>
                <td className="num">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel__note">
        The level edge compares the cards as played in this battle. Elixir
        leaked is the game’s own count of elixir lost while a player’s bar sat
        full.
      </div>
    </section>
  );
}

function resultText(row) {
  const word =
    row.outcome === "win" ? "won" : row.outcome === "loss" ? "lost" : "drew";
  // A duel's crowns are summed over its games, which reads as a score
  // it never had: the games are not on this row, so it says the result.
  if (row.duel) return `duel ${word}`;
  return `${word} ${row.crowns ?? "?"}–${row.crowns_against ?? "?"}`;
}

function Row({ row, current, when, who, sub }) {
  const tone =
    row.outcome === "win"
      ? " battle-row__result--win"
      : row.outcome === "loss"
        ? " battle-row__result--loss"
        : "";
  const body = (
    <>
      <span className="battle-row__when">{when}</span>
      <span
        className={`mode-chip__dot mode-chip__dot--${row.mode_group}`}
        title={MODE_LABEL[row.mode_group] ?? undefined}
      />
      <span className="battle-row__who">
        {who}
        {sub ? <span className="battle__note"> · {sub}</span> : null}
      </span>
      <span className={`battle-row__result${tone}`}>{resultText(row)}</span>
      {current && <span className="chip chip--ok">this battle</span>}
    </>
  );
  return (
    <li>
      {current || !row.url ? (
        <span
          className={`battle-row${current ? " battle-row--current" : ""}`}
          aria-current={current ? "page" : undefined}
        >
          {body}
        </span>
      ) : (
        <Link className="battle-row" to={pathOf(row.url)}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** Every recorded meeting of the two, newest first; shown once they have
 *  met more than this once. A tally only when every meeting was one
 *  mode: modes are different games and are never pooled. */
function Meetings({ read }) {
  const { whenDay, clock } = useClock();
  const rows = read.meetings ?? [];
  if (rows.length < 2) return null;
  const [l, r] = read.sides;
  const modes = new Set(rows.map((x) => x.mode_group));
  const w = rows.filter((x) => x.outcome === "win").length;
  const lost = rows.filter((x) => x.outcome === "loss").length;
  return (
    <section className="panel" aria-label="Their meetings">
      <div className="panel__head">
        <span className="battle-deck__head">
          <TagText>{nameOf(l.players[0])}</TagText> and{" "}
          <TagText>{nameOf(r.players[0])}</TagText>
        </span>
        {modes.size === 1 && (
          <span className="battle__note">
            {MODE_LABEL[[...modes][0]] ?? ""}{" "}
            <span className="mono-num">
              {w}–{lost}
            </span>
          </span>
        )}
      </div>
      <div className="panel__body">
        <ul className="battle-rows">
          {rows.map((x) => (
            <Row
              key={x.url ?? x.battle_time}
              row={x}
              current={x.url === read.battle.url}
              when={whenDay(x.battle_time)}
              who={clock(x.battle_time)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The left player's sitting: the battles around this one, chained by
 *  gaps under half an hour, newest first. */
function Sitting({ read }) {
  const { whenDay, clock } = useClock();
  const rows = read.sitting ?? [];
  if (rows.length < 2) return null;
  const who = nameOf(read.sides[0].players[0]);
  return (
    <section className="panel" aria-label={`${who}’s session`}>
      <div className="panel__head">
        <span className="battle-deck__head">
          <TagText>{who}</TagText>’s session
        </span>
        <span className="battle__note">{whenDay(rows[0].battle_time)}</span>
      </div>
      <div className="panel__body">
        <ul className="battle-rows">
          {rows.map((x) => (
            <Row
              key={x.url ?? x.battle_time}
              row={x}
              current={x.url === read.battle.url}
              when={clock(x.battle_time)}
              who={x.opponent ?? "Unknown"}
              sub={MODE_LABEL[x.mode_group] ?? null}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Text for an HTML attribute: a player names themselves, quotes and all. */
const attr = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function Share({ battle, sides, own }) {
  if (!battle.url) return null;
  // Just the picture and the link (Jamie: no embed for a blog).
  const alt = `${namesOf(sides[0])} against ${namesOf(sides[1])}, a Clash Royale battle on Elixir`;
  const post = battle.image
    ? `<a href="${attr(battle.url)}"><img src="${attr(battle.image)}" alt="${attr(alt)}" width="1200" height="630"></a>`
    : null;
  return (
    <section className="panel" aria-label="Share this battle">
      <div className="panel__head">Share this battle</div>
      <div className="panel__body">
        <div className="share-link">
          <Icon name="link-2" size={15} />
          <span className="share-link__url">{battle.url}</span>
          <CopyButton text={battle.url} className="btn btn--sm btn--gold" />
        </div>
        {battle.image && (
          <div className="share-actions">
            <a className="btn btn--sm" href={battle.image} download>
              <Icon name="layers" size={15} />
              Share image
            </a>
            <CopyButton text={post} label="Copy for a post" />
          </div>
        )}
        <p className="footnote">
          Anyone with the link can open this page, no account needed: both
          decks, how it ended, and the players’ game names.
        </p>
        {own && (
          <PlayerBattleShare
            key={battle.id}
            url={battle.url}
            players={`${namesOf(sides[0])} against ${namesOf(sides[1])}`}
          />
        )}
      </div>
    </section>
  );
}

/** For a reader with no account: what Elixir is, and the way in (#763).
 *  Both links carry this page as where to come back to, and nothing else:
 *  never who sent the link ("Invites carry no referral ids"). */
export function Invite({ who = null }) {
  const back = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  const title = who
    ? `Follow ${who} on Elixir`
    : "Follow these players on Elixir";
  return (
    <section className="kit-cta" aria-label={title}>
      <h2 className="kit-cta__title">{title}</h2>
      <p className="kit-cta__text">
        Elixir is where Clash Royale players follow each other’s battles and
        celebrate them. It’s free. Join or sign in and you come back to this
        page, ready to follow.
      </p>
      <div className="share-actions">
        <a className="btn btn--gold" href={`/signin?signup&return_to=${back}`}>
          Join Elixir
        </a>
        <a className="btn" href={`/signin?return_to=${back}`}>
          Sign in
        </a>
        <a className="btn btn--quiet" href="/">
          What is Elixir?
        </a>
      </div>
    </section>
  );
}
