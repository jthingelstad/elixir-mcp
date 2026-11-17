import { useState } from "react";
import { Navigate, useLocation } from "@tanstack/react-router";
import { Icon, PageHead } from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { useHome, useReconcilePassport } from "../lib/queries.js";
import { NewAccount } from "../home/NewAccount.jsx";
import { useFirstRead } from "../home/first-read.js";
import { HomeFeed, ModePick, useTimelineMode } from "../home/Feed.jsx";
import { keptFor } from "../home/logic.js";
import { useMayPost } from "../home/Post.jsx";
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

/** /timeline (/home until 2026-11-17): one feed, beside your week and your
 *  clan (slice 7, #765). */
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
  // The post composer (2026-11-17), opened from the feed's top or, on a
  // phone, from Post in the head.
  const [writing, setWriting] = useState(false);
  const mayPost = useMayPost();
  // The feed's mode (2026-11-17), in the address; the panels' quiet-week
  // check reads the same mode's feed, so it is one read.
  const [mode, setMode] = useTimelineMode(keptFor(me));
  // The passport's catch-up (#1015): once Home draws its feed (the profile
  // list's place), after first paint, never waited on. A new account's
  // first steps write nothing until the person acts.
  useReconcilePassport(Boolean(me) && ready);
  if (query.isError || data?.first?.ok === false)
    return (
      <>
        <PageHead title="Timeline" />
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
        <PageHead title="Timeline" />
        <div className="kit-skeleton" aria-busy="true" />
      </>
    );
  if (!ready)
    return (
      <>
        <PageHead
          title="Welcome to Elixir"
          sub="Add your player tag, and your battles show up here within about a minute."
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
            <HomeFeed mode={mode} setMode={setMode} />
          </section>
        ) : null}
      </>
    );
  // The head is the title and the feed's chips, as the canvas draws it; who
  // you are is Your week's, beside the feed.
  return (
    <>
      <PageHead
        title="Timeline"
        className="kit-head--home"
        aside={
          <>
            <div ref={setChipsAt} className="kit-home__chips" />
            <div className="kit-home__tools">
              <ModePick value={mode} onChange={setMode} />
              {mayPost ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary kit-home__post"
                  aria-expanded={writing}
                  onClick={(event) => {
                    // Some touch browsers do not focus a tapped button.
                    // Name this opener before the writing field takes focus.
                    event.currentTarget.focus();
                    setWriting(true);
                    document
                      .querySelector(".kit-post-compose")
                      ?.scrollIntoView?.({ block: "nearest" });
                  }}
                >
                  <Icon name="plus" size={16} />
                  Post
                </button>
              ) : null}
            </div>
            <TodayFresh player={player} />
          </>
        }
      />
      <HomePanels
        first={live}
        player={player}
        mode={mode}
        feed={({ suggest }) => (
          <HomeFeed
            chipsAt={chipsAt}
            suggest={suggest}
            compose={{ open: writing, setOpen: setWriting }}
            mode={mode}
            setMode={setMode}
            modeInHead
          />
        )}
      />
    </>
  );
}
