import { useLocation } from "@tanstack/react-router";
import { Link, PageHead, Tabs, TagText } from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { CONSOLE } from "../lib/console.js";
import { useHome, useHomeFriends, useTimelineDiscord } from "../lib/queries.js";
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

function HomeTabs({ value, me }) {
  const items = HOME_TABS.map((t) =>
    t.key === "timeline"
      ? { ...t, count: me?.signals?.timeline_pending ?? null }
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
        <HomeTabs value="today" me={me} />
        <TodayError busy={query.isFetching} onRetry={() => query.refetch()} />
      </>
    );
  if (query.isPending)
    return (
      <>
        <PageHead title="Today" />
        <HomeTabs value="today" me={me} />
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
      <HomeTabs value="today" me={me} />
      <TodayPanels data={data} me={me} player={player} />
    </>
  );
}

function TimelineTab() {
  const { me } = useMe();
  const discord = useTimelineDiscord();
  return (
    <>
      <PageHead
        title="Timeline"
        sub="The last seven days, newest first."
        aside={<DiscordLine status={discord.data} />}
      />
      <HomeTabs value="timeline" me={me} />
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
  const { me } = useMe();
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
      <HomeTabs value="friends" me={me} />
      <HomeFriends query={query} />
    </>
  );
}
