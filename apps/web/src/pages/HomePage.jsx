import { useLocation } from "@tanstack/react-router";
import { Link, PageHead, Tabs, TagText } from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { CONSOLE } from "../lib/console.js";
import {
  useHome,
  useHomeFriends,
  useTimelineDiscord,
  useTimelineNews,
} from "../lib/queries.js";
import { HOME_TABS } from "../home/logic.js";
import { NewAccount, recorded } from "../home/NewAccount.jsx";
import { TodayError, TodayFresh, TodayPanels } from "../home/Today.jsx";
import { HomeTimeline } from "../home/Timeline.jsx";
import { HomeFriends } from "../home/Friends.jsx";

/** /home, /home/timeline and /home/friends: one head, three tabs. */
export function HomePage() {
  const { pathname } = useLocation();
  const tab = pathname.replace(/\/$/, "").split("/")[2] ?? "today";
  return tab === "timeline" ? (
    <TimelineTab />
  ) : tab === "friends" ? (
    <FriendsTab />
  ) : (
    <TodayTab />
  );
}

/** The Timeline tab's mark says something was learned since the page was last
 *  opened. Only a mark: the real count takes the feed itself to build, and the
 *  page's New chip carries it, so the tab and the page cannot disagree. */
function HomeTabs({ value }) {
  const news = useTimelineNews();
  const items = HOME_TABS.map((t) =>
    t.key === "timeline"
      ? {
          ...t,
          mark: news.data?.unread === true,
          markLabel: "New since you last opened it",
        }
      : t,
  );
  return <Tabs label="Home" items={items} value={value} />;
}

function TodayTab() {
  const { me } = useMe();
  const query = useHome();
  const data = query.data;
  const player = data?.first?.player ?? null;
  const ready = player && recorded(player);
  if (query.isError || data?.first?.ok === false)
    return (
      <>
        <PageHead title="Today" />
        <HomeTabs value="today" />
        <TodayError busy={query.isFetching} onRetry={() => query.refetch()} />
      </>
    );
  if (query.isPending)
    return (
      <>
        <PageHead title="Today" />
        <HomeTabs value="today" />
        <div className="kit-skeleton" aria-busy="true" />
      </>
    );
  if (!ready)
    return (
      <>
        <PageHead
          title="Welcome to Elixir"
          sub="The game keeps about your last 30 battles. Elixir keeps reading them, so your record grows."
        />
        <NewAccount first={data.first} zoneMissing={!me?.timezone} />
      </>
    );
  const clanName = data.clan?.ok ? data.clan.name : null;
  return (
    <>
      <PageHead
        title="Today"
        sub={
          <>
            <TagText>{player.name ?? player.player_tag}</TagText>
            {clanName ? (
              <>
                {" · "}
                <TagText>{clanName}</TagText>
              </>
            ) : null}
          </>
        }
        aside={<TodayFresh player={player} />}
      />
      <HomeTabs value="today" />
      <TodayPanels data={data} me={me} player={player} />
    </>
  );
}

function TimelineTab() {
  const discord = useTimelineDiscord();
  return (
    <>
      <PageHead
        title="Timeline"
        sub="The last seven days, newest first."
        aside={<DiscordLine status={discord.data} />}
      />
      <HomeTabs value="timeline" />
      <HomeTimeline />
    </>
  );
}

function DiscordLine({ status }) {
  return (
    <Link
      to={`${CONSOLE}/account/connections#timeline-discord`}
      className="kit-tiny"
    >
      Discord sharing{status?.enabled ? " on" : ""} · Manage
    </Link>
  );
}

function FriendsTab() {
  const query = useHomeFriends();
  const week = query.data?.week?.label;
  return (
    <>
      <PageHead
        title="Friends"
        sub={
          week
            ? `Week of ${week}, the same week as Wednesday's mail.`
            : "The people you follow, the same week as Wednesday's mail."
        }
      />
      <HomeTabs value="friends" />
      <HomeFriends query={query} />
    </>
  );
}
