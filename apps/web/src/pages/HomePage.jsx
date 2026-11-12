import { Navigate, useLocation } from "@tanstack/react-router";
import { PageHead, TagText } from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { useHome, useHomeClan } from "../lib/queries.js";
import { panelOf } from "../home/logic.js";
import { NewAccount } from "../home/NewAccount.jsx";
import { useFirstRead } from "../home/first-read.js";
import { HomeFeed } from "../home/Feed.jsx";
import { HomePanels, TodayError, TodayFresh } from "../home/Today.jsx";

const followsSomeone = (me) =>
  (me?.claims ?? []).some(
    (c) =>
      !(
        c.is_primary ||
        c.relationship === "alt" ||
        c.relationship === "primary"
      ),
  );

/** /home: one feed, beside your week and your clan (slice 7, #765). Its three
 *  tabs went; their old addresses land here (lib/moved.js). */
export function HomePage() {
  const { me } = useMe();
  const { hash } = useLocation();
  const query = useHome();
  const data = query.data;
  // The first read, whichever view is drawn: until the player's own battle
  // log is read, one status read polls and Home refreshes once it lands.
  const { answer, live, player, ready } = useFirstRead(data?.first);
  // The head's clan name comes when the panel's read does; no read at all for
  // a new account, whose page has no panels.
  const clan = panelOf(useHomeClan(Boolean(ready)), "clan");
  if (query.isError || data?.first?.ok === false)
    return (
      <>
        <PageHead title="Home" />
        <TodayError busy={query.isFetching} onRetry={() => query.refetch()} />
      </>
    );
  // "Add your player" from Ladder or Clan, on an account that follows someone
  // but has no player of its own: Home's steps are over, Settings adds one.
  if (player && hash === "add-player")
    return <Navigate to="/settings/players" hash="add-player-tag" replace />;
  if (query.isPending)
    return (
      <>
        <PageHead title="Home" />
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
        <NewAccount
          first={live}
          answer={answer}
          landed={ready}
          zoneMissing={!me?.timezone}
        />
        {/* Someone followed before a player of your own: their feed is
            here already, as the Timeline tab was [engineering, 2026-11-12]. */}
        {followsSomeone(me) ? (
          <section className="kit-home__main" aria-label="Your feed">
            <HomeFeed />
          </section>
        ) : null}
      </>
    );
  const clanName = clan?.ok ? clan.name : null;
  return (
    <>
      <PageHead
        title="Home"
        sub={
          <>
            <TagText>
              {player.nickname ?? player.name ?? player.player_tag}
            </TagText>
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
      <HomePanels first={live} player={player} feed={<HomeFeed />} />
    </>
  );
}
