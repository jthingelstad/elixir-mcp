import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { PlayerInClan, useClanOf } from "../clan/views/PlayerInClan.jsx";
import {
  Avatar,
  Empty,
  ErrorState,
  Icon,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tabs,
  Tag,
  TagText,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { useNav } from "../App.jsx";
import { trackEvent } from "../analytics.js";
import { ladderHref } from "../ladder/ladder.js";
import { followMeHref, playerHref } from "../lib/player.js";
import {
  usePlayerEvidence,
  usePlayerPage,
  useRefreshPlayerPage,
} from "../lib/queries.js";
import { tagFromPath } from "../lib/tag-url.js";
import { SessionGames } from "./SessionGames.jsx";
import { Cheers, usePageCheered } from "./Cheers.jsx";
import { evidenceWord, Sitting, SITTINGS } from "./Session.jsx";
import { FollowAll, FollowButton } from "./follow.jsx";
import { PlayerRecord } from "./PlayerRecord.jsx";

/**
 * A player's page (slice 6, #764): the one page every player name opens
 * (Jamie, 2026-11-12: "Yes, one page"). Signed-in members only; Home's shell
 * puts the sign-in wall in front of it.
 *
 * What it shows is DECISIONS "What is public about an account" and no more:
 * the player's game record, and for a player an account verified, that
 * account's follows, followers and badges. Game names and tags only: never a
 * nickname (yours included), a Discord username or an email. Ladder stays
 * reachable from here, as a link. Clan's member page folded in as the Clan
 * tab (2026-11-12), for a viewer with a player in their clan only.
 */
export const PLAYER_TABS = [
  { key: "timeline", label: "Timeline" },
  { key: "highlights", label: "Highlights" },
  { key: "moments", label: "Moments" },
  { key: "follows", label: "Follows" },
  // Explore's player and profile records, folded in (2026-11-12).
  { key: "record", label: "Record" },
];

/** Their record in your clan, the member page Clan kept until 2026-11-12:
 *  drawn only for a viewer with a player in that clan. */
const CLAN_TAB = { key: "clan", label: "Clan" };
const OWN_TABS = new Set([...PLAYER_TABS.map((t) => t.key), CLAN_TAB.key]);
export function PlayerPage() {
  const { pathname, search } = useLocation();
  const tag = tagFromPath(pathname.replace(/\/$/, "").split("/")[3] ?? "");
  const query = usePlayerPage(tag);
  // An address that names no tag reads nothing: the query never runs.
  if (!tag) return <Empty title="That is not a player tag" />;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || (query.data && query.data.status >= 500))
    return (
      <ErrorState
        title="This player could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again shortly.
      </ErrorState>
    );
  const env = query.data;
  if (env.status === 400) return <Empty title="That is not a player tag" />;
  if (env.status === 429)
    return (
      <Empty title="Elixir is busy for you just now">
        {env.data?.message ?? "Try again in a little while."}
      </Empty>
    );
  if (env.status === 404)
    return (
      <>
        <PageHead title={<Tag tag={tag} />} />
        <Empty
          title="Elixir has not recorded this player"
          action={<FollowButton tag={tag} />}
        >
          Following them starts recording them. Check the tag first: tags never
          change, names do.
        </Empty>
      </>
    );
  return (
    <PlayerView
      page={env.data}
      initialTab={typeof search?.tab === "string" ? search.tab : undefined}
    />
  );
}

/** The page itself. You (`/home/you`) draws your primary player's with its
 *  own tabs after its five (Stats, 2026-11-12), each an address, and opens
 *  on the tab the address names. */
export function PlayerView({
  page,
  extraTabs = [],
  initialTab = "timeline",
  self = false,
}) {
  const nav = useNav();
  const [tab, setTab] = useState(
    OWN_TABS.has(initialTab) ? initialTab : "timeline",
  );
  const p = page.player;
  // Cheers only on what is in your own feed now: a player you follow, or
  // your clan's member, in the last week.
  const cheered = usePageCheered({ player: p.tag });
  const you = page.you;
  // Your page (You) never draws it. Another of your players does, when it
  // is not the one you act as in that clan: that one's place in Clan is
  // its own page there (Codex on #831).
  const clanEntry = useClanOf(p.clan_tag, !self);
  const inClan =
    clanEntry.clan && clanEntry.clan.acting_as === p.tag
      ? { clan: null, pending: false }
      : clanEntry;
  // An address asking for Clan before Clan answers waits for it; once it
  // has, a viewer outside the clan reads the timeline.
  const shown =
    tab === "clan" && !inClan.clan && !inClan.pending ? "timeline" : tab;
  const sub = [
    p.tag,
    p.clan_name ?? (p.clan_tag ? p.clan_tag : "No clan"),
    p.trophies != null ? `${p.trophies.toLocaleString()} trophies` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const items = [
    ...PLAYER_TABS.map((t) => ({
      ...t,
      count:
        t.key === "highlights"
          ? page.highlights.length
          : t.key === "moments"
            ? page.moments.length
            : null,
    })),
    ...(inClan.clan ? [CLAN_TAB] : []),
    ...extraTabs,
  ];
  return (
    <div className="kit-home kit-player">
      <header className="kit-phead">
        <Avatar name={p.name ?? p.tag} tag={p.tag} large />
        <div className="kit-phead__main">
          <h1 className="kit-phead__name">
            <TagText>{p.name ?? p.tag}</TagText>
          </h1>
          <p className="kit-phead__line">
            <TagText>{sub}</TagText>
          </p>
          <Badges badges={page.badges} />
          <Counts page={page} onPick={setTab} />
        </div>
        <nav className="kit-phead__actions" aria-label="More about this player">
          {you.own && !self ? (
            <Link
              to={ladderHref("season", { player: p.tag })}
              className="btn btn--sm"
            >
              Your stats
            </Link>
          ) : you.following && !you.own ? (
            <Link
              to={ladderHref("season", { player: p.tag })}
              className="btn btn--sm"
            >
              Their stats
            </Link>
          ) : null}
          {p.clan_tag && !you.own ? (
            <FollowAll
              ask={{ clan_tag: p.clan_tag }}
              label={`Follow everyone in ${p.clan_name ?? "their clan"}`}
              title={`Follow everyone in ${p.clan_name ?? p.clan_tag}?`}
            />
          ) : null}
          {you.own ? <CopyFollowMe tag={p.tag} /> : null}
          {you.own ? (
            <span className="kit-phead__state">You</span>
          ) : you.following ? (
            <span className="kit-phead__state">Following</span>
          ) : (
            <FollowButton tag={p.tag} name={p.name} />
          )}
        </nav>
      </header>
      <Tabs
        label="Player"
        items={items}
        value={shown}
        // A tab that is an address (You's Stats) leaves this page instead.
        onSelect={(k) => OWN_TABS.has(k) && setTab(k)}
      />
      <div className={shown === "clan" ? undefined : "kit-player__body"}>
        {shown === "clan" ? (
          inClan.clan ? (
            <PlayerInClan clan={inClan.clan} playerTag={p.tag} navigate={nav} />
          ) : (
            <div className="kit-skeleton" aria-busy="true" />
          )
        ) : shown === "timeline" ? (
          <ItemList
            items={page.timeline}
            empty={`Nothing recorded in the last ${page.window_days} days.`}
            more={page.timeline_more}
            cheered={cheered}
            tag={p.tag}
          />
        ) : shown === "highlights" ? (
          <Highlights items={page.highlights} cheered={cheered} />
        ) : shown === "moments" ? (
          <Moments
            items={page.moments}
            empty={`No moments in the last ${page.window_days} days.`}
            cheered={cheered}
          />
        ) : shown === "record" ? (
          <PlayerRecord tag={p.tag} />
        ) : (
          <Follows page={page} />
        )}
      </div>
    </div>
  );
}

/** The verifying account's badges: that it verified this player, and that it
 *  linked a Discord, never which. */
function Badges({ badges }) {
  if (!badges.verified_player) return null;
  return (
    <p className="kit-player__badges">
      <span className="kit-badge kit-badge--ok">
        <Icon name="check" size={12} /> Verified player
      </span>
      {badges.discord ? (
        <span className="kit-badge">Verified in Discord</span>
      ) : null}
    </p>
  );
}

/** The account's counts (canvas .statrow), each a button to its tab. */
function Counts({ page, onPick }) {
  if (!page.follows) return null;
  const n = (v) => v.toLocaleString();
  const stat = (label, value, tab) => (
    <button
      type="button"
      className="kit-statrow__btn kit-stat"
      onClick={() => onPick(tab)}
    >
      <span className="kit-stat__label">{label}</span>{" "}
      <span className="kit-stat__value">{n(value)}</span>
    </button>
  );
  return (
    <div className="kit-statrow">
      {stat("Following", page.follows.count, "follows")}
      {stat("Followers", page.followers.count, "follows")}
      {stat("Highlights", page.highlights.length, "highlights")}
    </div>
  );
}

/** A clan's own line on a player's timeline wears the clan's medal. */
const CLAN_KINDS = new Set([
  "race_finished",
  "week_resolved",
  "bracket_observed",
  "member_joined",
  "member_left",
  "member_role_changed",
]);
/** A card's first is a violet medal, as on Home. */
const VIOLET = new Set(["card_unlocked", "card_form_unlocked"]);

/** The medal tile beside an item (canvas Player .item): a sitting's bars, a
 *  highlight's bookmark, a clan's shield, a moment's star. */
function Medal({ kind, tile = true }) {
  const [icon, tone] = SITTINGS.has(kind)
    ? ["activity", "violet"]
    : kind === "battle_highlight"
      ? ["bookmark", ""]
      : CLAN_KINDS.has(kind)
        ? ["shield", "clan"]
        : ["star", VIOLET.has(kind) ? "violet" : ""];
  return (
    <span
      className={`kit-medal${tile ? " kit-medal--tile" : ""}${tone ? ` kit-medal--${tone}` : ""}`}
      aria-hidden="true"
    >
      <Icon name={icon} size={22} />
    </span>
  );
}

const battlePath = (it) =>
  String(it.battle_url ?? "").replace(/^https?:\/\/[^/]+/, "");

/** Items under the day they happened, newest first, as Home's feed. */
function byDay(items, dayKey) {
  const days = [];
  for (const it of items) {
    const key = it.at ? dayKey(it.at) : "";
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(it);
    else days.push({ key, at: it.at, rows: [it] });
  }
  return days;
}

function ItemList({ items, empty, more = 0, cheered, tag }) {
  const { when, feedWhen, day, feedDayHeading: dayHeading } = useClock();
  const [openId, setOpenId] = useState(null);
  if (items.length === 0) return <p className="kit-week__quiet">{empty}</p>;
  return (
    <>
      {byDay(items, day).map((d) => (
        <section
          key={d.key}
          className="kit-day"
          aria-label={d.at ? dayHeading(d.at) : undefined}
        >
          {d.at ? <h2 className="kit-day__head">{dayHeading(d.at)}</h2> : null}
          {d.rows.map((it, i) => {
            const battle = battlePath(it);
            const withCheers = cheered?.of(it);
            // A sitting draws as Home draws it (G7): its sparkline, its
            // numbers and its games, read in place.
            const sitting = SITTINGS.has(it.kind);
            const games = sitting && tag && it.id && it.evidence;
            const open = games && openId === it.id;
            return (
              <article
                key={it.id ?? `${d.key}-${i}`}
                className={`kit-feed__item kit-pitem${CLAN_KINDS.has(it.kind) ? " kit-feed__item--clan" : ""}`}
              >
                <div className="kit-pitem__body">
                  <Medal kind={it.kind} />
                  <div className="kit-pitem__main">
                    <p className="kit-feed__text">
                      <TagText>{it.text}</TagText>
                    </p>
                    {it.at ? (
                      <time
                        className="kit-feed__time"
                        dateTime={it.at}
                        title={when(it.at)}
                      >
                        {feedWhen(it.at)}
                      </time>
                    ) : null}
                    {it.words ? (
                      <p className="kit-feed__words">{it.words}</p>
                    ) : null}
                    {sitting ? <Sitting it={it} /> : null}
                    {open ? (
                      <PlayerGames
                        tag={tag}
                        item={it}
                        onClose={() => setOpenId(null)}
                      />
                    ) : null}
                  </div>
                </div>
                {withCheers || games || battle.startsWith("/battle/") ? (
                  <footer className="kit-feed__foot">
                    {withCheers ? (
                      <Cheers it={withCheers} where={cheered.where} />
                    ) : null}
                    <span className="share-actions kit-feed__links">
                      {games ? (
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-expanded={Boolean(open)}
                          onClick={() => setOpenId(open ? null : it.id)}
                        >
                          {evidenceWord(it, open)}
                        </button>
                      ) : null}
                      {battle.startsWith("/battle/") ? (
                        <Link to={battle} className="btn btn--sm">
                          Open the battle
                        </Link>
                      ) : null}
                    </span>
                  </footer>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
      {more > 0 ? (
        <p className="kit-tiny">
          The {items.length} newest are shown; {more.toLocaleString()} more are
          not.
        </p>
      ) : null}
    </>
  );
}

/** The Highlights tab (canvas .hcard): each the player's pick, with their
 *  words, its cheers and its battle. */
function Highlights({ items, cheered }) {
  const { when, feedWhen } = useClock();
  if (items.length === 0)
    return <p className="kit-week__quiet">No highlights posted yet.</p>;
  return items.map((it, i) => {
    const battle = battlePath(it);
    const withCheers = cheered?.of(it);
    return (
      <article key={it.id ?? i} className="kit-hcard">
        <p className="kit-hcard__when">
          <Icon name="crown" size={18} />
          {it.at ? (
            <time dateTime={it.at} title={when(it.at)}>
              {feedWhen(it.at)}
            </time>
          ) : null}
        </p>
        <p className="kit-hcard__title">
          <TagText>{it.text}</TagText>
        </p>
        {it.words ? <p className="kit-hcard__words">“{it.words}”</p> : null}
        {withCheers || battle.startsWith("/battle/") ? (
          <footer className="kit-feed__foot">
            {withCheers ? (
              <Cheers it={withCheers} where={cheered.where} />
            ) : null}
            <span className="share-actions kit-feed__links">
              {battle.startsWith("/battle/") ? (
                <Link to={battle} className="btn btn--sm">
                  Open the battle
                </Link>
              ) : null}
            </span>
          </footer>
        ) : null}
      </article>
    );
  });
}

/** The Moments tab: sunken tiles, a medal each (canvas Player moments). */
function Moments({ items, empty, cheered }) {
  const { when, feedWhen } = useClock();
  if (items.length === 0) return <p className="kit-week__quiet">{empty}</p>;
  return (
    <ul className="kit-moments">
      {items.map((it, i) => {
        const battle = battlePath(it);
        const withCheers = cheered?.of(it);
        return (
          <li key={it.id ?? i} className="kit-moment">
            <Medal kind={it.kind} tile={false} />
            <div className="kit-moment__main">
              <span className="kit-moment__title">
                <TagText>{it.text}</TagText>
              </span>
              {it.at ? (
                <time className="kit-tiny" dateTime={it.at} title={when(it.at)}>
                  {feedWhen(it.at)}
                </time>
              ) : null}
              {battle.startsWith("/battle/") ? (
                <Link to={battle} className="link kit-tl__more">
                  Open the battle
                </Link>
              ) : null}
              {withCheers ? (
                <Cheers it={withCheers} where={cheered.where} />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A sitting's games, read in place from the player page's own read, as
 *  Home's feed reads its own. */
function PlayerGames({ tag, item, onClose }) {
  const [offset, setOffset] = useState(0);
  const refresh = useRefreshPlayerPage(tag);
  const query = usePlayerEvidence({
    tag,
    evidence_item_id: item.id,
    expected_evidence_version: item.evidence.version,
    evidence_offset: String(offset),
  });
  return (
    <SessionGames
      item={item}
      query={query}
      offset={offset}
      setOffset={setOffset}
      onRefresh={() => {
        onClose();
        refresh();
      }}
    />
  );
}

/** Who the account follows and who follows it, by game name and tag. */
function Follows({ page }) {
  if (!page.follows)
    return (
      <p className="kit-week__quiet">
        No account has verified this player, so there are no follows to show.
        Follows belong to an account, and a page shows them for the player its
        account verified.
      </p>
    );
  const people = (list) =>
    list.map((f) => (
      <Row
        key={f.tag}
        href={playerHref(f.tag)}
        lead={<Avatar name={f.name ?? f.tag} tag={f.tag} small />}
        title={<TagText>{f.name ?? f.tag}</TagText>}
        detail={f.name ? <Tag tag={f.tag} /> : null}
      />
    ));
  const unnamed = page.followers.unnamed ?? 0;
  return (
    <div className="kit-pfollows">
      <Panel
        title={`Following ${page.follows.count.toLocaleString()}`}
        titleAs="h2"
      >
        {page.follows.players.length ? (
          <Rows>{people(page.follows.players)}</Rows>
        ) : (
          <p className="kit-panel__body kit-week__quiet">Nobody yet.</p>
        )}
      </Panel>
      <Panel
        title={`Followers ${page.followers.count.toLocaleString()}`}
        titleAs="h2"
      >
        {page.followers.players.length ? (
          <Rows>{people(page.followers.players)}</Rows>
        ) : null}
        {unnamed > 0 || page.followers.count === 0 ? (
          <p className="kit-panel__body kit-tiny">
            {page.followers.count === 0
              ? "Nobody yet."
              : `${unnamed.toLocaleString()} more ${unnamed === 1 ? "account has" : "accounts have"} no verified player, so ${unnamed === 1 ? "it is" : "they are"} counted, not named.`}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

/** Your own page offers your Follow me link: the tag, and nothing else. A
 *  copy is one aggregate event, never who copied it. */
function CopyFollowMe({ tag }) {
  const [copied, flash] = useFlash();
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        navigator.clipboard?.writeText(
          `${window.location.origin}${followMeHref([tag])}`,
        );
        trackEvent("home.follow_me_copied");
        flash();
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : "Copy my Follow me link"}
    </button>
  );
}
