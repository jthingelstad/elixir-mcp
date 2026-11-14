import { useState } from "react";
import { Navigate, useLocation } from "@tanstack/react-router";
import { PageHead } from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { useHome } from "../lib/queries.js";
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

/** /home: one feed, beside your week and your clan (slice 7, #765). */
export function HomePage() {
  const { me } = useMe();
  const { hash } = useLocation();
  const query = useHome();
  const data = query.data;
  // The first read, whichever view is drawn: until the player's own battle
  // log is read, one status read polls and Home refreshes once it lands.
  const { answer, live, player, ready } = useFirstRead(data?.first);
  // Where the feed puts its chips: the head, right of the title (design
  // canvas, 2026-11-13). The feed draws them above itself until it is set.
  const [chipsAt, setChipsAt] = useState(null);
  if (query.isError || data?.first?.ok === false)
    return (
      <>
        <PageHead title="Home" />
        <TodayError busy={query.isFetching} onRetry={() => query.refetch()} />
      </>
    );
  // "Add your player" from Stats or Clan, on an account that follows someone
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
  // The head is the title and the feed's chips, as the canvas draws it; who
  // you are is Your week's, beside the feed.
  return (
    <>
      <PageHead
        title="Home"
        className="kit-head--home"
        aside={
          <>
            <div ref={setChipsAt} className="kit-home__chips" />
            <TodayFresh player={player} />
          </>
        }
      />
      <HomePanels
        first={live}
        player={player}
        feed={<HomeFeed chipsAt={chipsAt} />}
      />
    </>
  );
}
