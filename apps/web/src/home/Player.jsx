import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  PlayerInClan,
  useClanOf,
} from "@elixir-mcp/clan-web/views/PlayerInClan.jsx";
import {
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
import { useMe, useNav } from "../App.jsx";
import { trackEvent } from "../analytics.js";
import { ladderHref } from "../ladder/ladder.js";
import { followMeHref, playerHref } from "../lib/player.js";
import {
  usePlayerEvidence,
  usePlayerPage,
  useRefreshPlayerPage,
} from "../lib/queries.js";
import { tagFromPath } from "../lib/tag-url.js";
import { TimelineEvidence } from "../views/account/timeline-shared.jsx";
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
  const { me } = useMe();
  const nav = useNav();
  const [tab, setTab] = useState(
    OWN_TABS.has(initialTab) ? initialTab : "timeline",
  );
  const p = page.player;
  // Cheers only on what is in your own feed now: a player you follow, or
  // your clan's member, in the last week.
  const cheered = usePageCheered({ player: p.tag });
  const you = page.you;
  const clanOpen = me?.features?.clan_internal === true;
  const inClan = useClanOf(p.clan_tag, clanOpen && !you.own);
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
      <PageHead
        title={<TagText>{p.name ?? p.tag}</TagText>}
        sub={<TagText>{sub}</TagText>}
        aside={
          you.own ? (
            <span className="kit-tiny">You</span>
          ) : you.following ? (
            <span className="kit-tiny">Following</span>
          ) : (
            <FollowButton tag={p.tag} name={p.name} />
          )
        }
      >
        <Badges badges={page.badges} />
        <Counts page={page} />
      </PageHead>
      <nav className="kit-player__doors" aria-label="More about this player">
        {you.own && !self ? (
          <Link to={ladderHref("season", { player: p.tag })}>Your stats</Link>
        ) : null}
        {p.clan_tag && !you.own ? (
          <FollowAll
            ask={{ clan_tag: p.clan_tag }}
            label={`Follow everyone in ${p.clan_name ?? "their clan"}`}
            title={`Follow everyone in ${p.clan_name ?? p.clan_tag}?`}
          />
        ) : null}
        {you.own ? <CopyFollowMe tag={p.tag} /> : null}
      </nav>
      <Tabs
        label="Player"
        items={items}
        value={shown}
        // A tab that is an address (You's Stats) leaves this page instead.
        onSelect={(k) => OWN_TABS.has(k) && setTab(k)}
      />
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
        <ItemList
          items={page.highlights}
          empty="No highlights posted yet."
          words
          cheered={cheered}
        />
      ) : shown === "moments" ? (
        <ItemList
          items={page.moments}
          empty={`No moments in the last ${page.window_days} days.`}
          cheered={cheered}
          tag={p.tag}
        />
      ) : shown === "record" ? (
        <PlayerRecord tag={p.tag} />
      ) : (
        <Follows page={page} />
      )}
    </div>
  );
}

/** The verifying account's badges: that it verified this player, and that it
 *  linked a Discord, never which. */
function Badges({ badges }) {
  if (!badges.verified_player) return null;
  return (
    <p className="kit-player__badges">
      <span className="kit-badge">
        <Icon name="check" size={12} /> Verified player
      </span>
      {badges.discord ? (
        <span className="kit-badge">Verified in Discord</span>
      ) : null}
    </p>
  );
}

function Counts({ page }) {
  if (!page.follows) return null;
  const n = (v) => v.toLocaleString();
  return (
    <p className="kit-tiny">
      Following {n(page.follows.count)} · Followers {n(page.followers.count)} ·
      Highlights {n(page.highlights.length)}
    </p>
  );
}

function ItemList({ items, empty, more = 0, words = false, cheered, tag }) {
  const { when } = useClock();
  const [openId, setOpenId] = useState(null);
  if (items.length === 0)
    return (
      <Panel pad>
        <p className="kit-week__quiet">{empty}</p>
      </Panel>
    );
  return (
    <Panel pad>
      {items.map((it, i) => {
        const battle = String(it.battle_url ?? "").replace(
          /^https?:\/\/[^/]+/,
          "",
        );
        const withCheers = cheered?.of(it);
        // A sitting draws as Home draws it (G7): its sparkline, its numbers
        // and its games, read in place.
        const sitting = SITTINGS.has(it.kind);
        const games = sitting && tag && it.id && it.evidence;
        const open = games && openId === it.id;
        return (
          <div key={it.id ?? i} className="kit-row kit-tl">
            <span className="kit-row__main">
              <span className="kit-row__title">
                <TagText>{it.text}</TagText>
              </span>
              {words && it.words ? (
                <span className="kit-row__detail">“{it.words}”</span>
              ) : null}
              {sitting ? <Sitting it={it} /> : null}
              {battle.startsWith("/battle/") ? (
                <Link to={battle} className="link kit-tl__more">
                  Open the battle
                </Link>
              ) : null}
              {games ? (
                <button
                  type="button"
                  className="link kit-tl__more"
                  aria-expanded={Boolean(open)}
                  onClick={() => setOpenId(open ? null : it.id)}
                >
                  {evidenceWord(it, open)}
                </button>
              ) : null}
              {open ? (
                <PlayerGames
                  tag={tag}
                  item={it}
                  onClose={() => setOpenId(null)}
                />
              ) : null}
              {withCheers ? (
                <Cheers it={withCheers} where={cheered.where} />
              ) : null}
            </span>
            <span className="kit-row__right">{it.at ? when(it.at) : null}</span>
          </div>
        );
      })}
      {more > 0 ? (
        <p className="kit-tiny">
          The {items.length} newest are shown; {more.toLocaleString()} more are
          not.
        </p>
      ) : null}
    </Panel>
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
    <div className="kit-tl__evidence">
      <TimelineEvidence
        selected={item}
        query={query}
        offset={offset}
        setOffset={setOffset}
        onRefresh={() => {
          onClose();
          refresh();
        }}
      />
    </div>
  );
}

/** Who the account follows and who follows it, by game name and tag. */
function Follows({ page }) {
  if (!page.follows)
    return (
      <Panel pad>
        <p className="kit-week__quiet">
          No account has verified this player, so there are no follows to show.
          Follows belong to an account, and a page shows them for the player its
          account verified.
        </p>
      </Panel>
    );
  const people = (list) =>
    list.map((f) => (
      <Row
        key={f.tag}
        href={playerHref(f.tag)}
        title={<TagText>{f.name ?? f.tag}</TagText>}
        detail={f.name ? <Tag tag={f.tag} /> : null}
      />
    ));
  const unnamed = page.followers.unnamed ?? 0;
  return (
    <>
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
    </>
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
