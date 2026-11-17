import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  Chip,
  Chips,
  Empty,
  ErrorState,
  Link,
  Icon,
  useClock,
} from "@elixir-mcp/ui";
import {
  reloadHomeFeed,
  useHomeFeed,
  useHomeFeedEvidence,
  useHomeCircle,
  useHomeFeedNew,
  useMyPassport,
} from "../lib/queries.js";
import { useMe } from "../App.jsx";
import {
  TimelineEvidence,
  useTimelinePlace,
} from "../views/account/timeline-shared.jsx";
import {
  feedChips,
  feedShown,
  askedShow,
  keepShow,
  keptShow,
  feedSince,
  quietFeed,
  timelineDays,
} from "./logic.js";
import { FeedRows } from "./FeedItem.jsx";
import { SessionGames } from "./SessionGames.jsx";
import { PeopleToFollow } from "./People.jsx";
import { PostComposer } from "./Post.jsx";

/**
 * Home's one feed (slice 7, #765): the last seven days of everyone you
 * follow, your clan and you, newest first, in days. The chips only choose
 * what is shown; the read is the timeline's, so the page's place ("New since
 * your last visit") is the one it always was, and opening Home moves it and
 * nothing a connection has read (standing ruling, 2026-10-20).
 *
 * An item is a session with its sparkline, a moment with its art and its
 * battle, a highlight in its player's words, or a clan's line, identified
 * by its band; short sessions are one line, and short sessions in a row one
 * group that opens in place (FeedItem.jsx, 2026-11-17).
 * Every player's name opens their page, and every item carries its
 * cheers (Cheers.jsx). Your account's own lines (claims, recording started
 * or stopped) are not here: the read leaves them out and the bell tells
 * them (2026-11-12).
 *
 * Thirty items a page, and More for the next thirty of the same week (G1,
 * 2026-11-12: a busy week was 150 items, 15 to 25 s to read and 20,870 px
 * of page). The chips count the whole week; they show what is loaded.
 *
 * The chips sit in the page's head, right of its title, when the page gives
 * them a place (`chipsAt`, design canvas 2026-11-13), else above the feed.
 * New is one more toggle in the same row, not a second row of chips: on, it
 * keeps only what is new since your last visit, under whichever Show chip.
 *
 * Close friends (2026-11-16) is one more Show chip, offered once you have
 * marked one, and the Show choice is remembered per account in this
 * browser. Like every Show chip it only chooses what is shown: opening the
 * feed moves your place as it always did, whichever chip is lit, so the
 * bell's dot and New mean the same thing under every chip.
 *
 * The feed is read when Home opens and when the reader asks, never under
 * them (2026-11-14): an open Home asks a cheap count once a minute while its
 * tab is visible, and when new items have arrived an "N new" pill floats
 * at the feed's top without moving anything. Tapping it reads the first
 * page again and brings the feed's top into view (NewPill).
 *
 * A quiet week (#1016) says why from the passport's follow counts (Quiet)
 * and leads to Find. With `suggest`, Home's People to follow moves here,
 * under it, so a phone sees who to follow without scrolling past the side
 * panels; Home leaves the side panel out meanwhile.
 */
export function HomeFeed({
  chipsAt = null,
  suggest = false,
  compose = null,
} = {}) {
  // The post composer's open state (2026-11-17): the page head's Post
  // opens it on a phone, so the page may hold it; else the feed does.
  const [ownOpen, setOwnOpen] = useState(false);
  const writing = compose ?? { open: ownOpen, setOpen: setOwnOpen };
  const composer = (
    <PostComposer open={writing.open} setOpen={writing.setOpen} />
  );
  const { day, feedDayHeading: dayHeading } = useClock();
  const query = useHomeFeed();
  const pages = query.data?.pages ?? [];
  const timeline = pages[0] ?? null;
  const { openedMs } = useTimelinePlace(timeline);
  // The Show chip, as this account left it here (2026-11-16).
  const { me } = useMe();
  // Kept per account: its page id, else its main player, else this browser.
  const who = me?.authenticated
    ? (me.page_id ??
      (me.claims ?? []).find((c) => c.is_primary)?.player_tag ??
      "account")
    : null;
  const [picked, setPicked] = useState(null);
  // A notice's address may ask for a chip (?show=close); read once.
  const [asked] = useState(() =>
    typeof window === "undefined" ? null : askedShow(window.location.search),
  );
  const circle = useHomeCircle();
  const hasClose = (circle.data?.circle?.friends?.length ?? 0) > 0;
  const chipList = feedChips(hasClose);
  const wanted = picked ?? asked ?? keptShow(who);
  // A kept Close friends with nobody marked any more is Everyone; while the
  // circle is still reading, the kept choice holds.
  const show =
    wanted === "close" && circle.isSuccess && !hasClose ? "everyone" : wanted;
  const setShow = (v) => {
    setPicked(v);
    keepShow(who, v);
  };
  const [newOnly, setNewOnly] = useState(false);
  const [openId, setOpenId] = useState(null);
  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p?.timeline ?? []),
    [query.data],
  );
  const isNew = (it) =>
    openedMs !== null && Date.parse(it.observed_at ?? it.at) > openedMs;
  // Q8 keeps the State chips; the four Show chips replace its Who chips
  // (Jamie, 2026-11-12).
  // The passport is Home's read already (the profile list's); a quiet feed
  // reads its follow counts, and only then.
  const quiet = query.isSuccess && items.length === 0;
  const passport = useMyPassport(quiet);
  const shown = feedShown(items, show).filter((it) => !newOnly || isNew(it));
  const more = timeline?.timeline_more ?? 0;
  const fresh = useHomeFeedNew(query.isSuccess ? feedSince(timeline) : null);
  const top = useRef(null);
  const pill =
    fresh.data > 0 && !query.isFetching ? (
      <NewPill count={fresh.data} top={top} />
    ) : null;
  if (query.isPending)
    return (
      <p className="kit-feed__reading" aria-busy="true">
        Reading the last seven days…
      </p>
    );
  // Only a first page that failed is the feed's failure: a More that failed
  // keeps the pages already read and says so beside More (Codex on #800).
  // A refetch that failed with nothing to keep is a failure too (#802).
  const refetchFailed = query.isRefetchError && !query.isFetchNextPageError;
  if (
    query.isError &&
    (pages.length === 0 || (refetchFailed && items.length === 0))
  )
    return (
      <ErrorState
        title="Your feed could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Nothing was lost. Try again in a moment.
      </ErrorState>
    );
  if (items.length === 0)
    return (
      <div ref={top} tabIndex={-1} className="kit-feed__top">
        {pill}
        {composer}
        <Quiet
          follows={
            passport.data?.ok
              ? (passport.data.data?.owner?.profile?.follows ?? null)
              : null
          }
          suggest={suggest}
        />
      </div>
    );
  const days = timelineDays(shown, { day, openedMs });
  // The week's counts, from the first page; what is loaded, if it has none.
  const counts = Object.fromEntries(
    chipList.map((c) => [
      c.key,
      timeline.counts?.[c.key] ?? feedShown(items, c.key).length,
    ]),
  );
  // The server's New count is against the place it read; once a visit opens
  // on a later place (the page marked it), count what is loaded instead, so
  // the chip and the items it filters agree (Codex on #800).
  const countedFrom = timeline.counts?.new_since ?? null;
  const newCount =
    timeline.counts?.new !== undefined &&
    (countedFrom ? Date.parse(countedFrom) : null) === openedMs
      ? timeline.counts.new
      : items.filter(isNew).length;
  const total = timeline.total ?? items.length;
  const chips = (
    <FeedFilters>
      <Chips
        label="Show"
        options={chipList.map((c) => ({ ...c, count: counts[c.key] }))}
        value={show}
        onChange={setShow}
      />
      {openedMs !== null ? (
        <Chip
          className="kit-chip--new"
          pressed={newOnly}
          count={newCount}
          onClick={() => setNewOnly(!newOnly)}
          aria-label={`New since your last visit: ${newCount}`}
        >
          New
        </Chip>
      ) : null}
    </FeedFilters>
  );
  return (
    <div ref={top} tabIndex={-1} className="kit-feed kit-feed__top">
      {pill}
      {refetchFailed ? (
        // A refetch that failed keeps what was read, and says it may be
        // behind, with a way to try again (Codex on #802).
        <div className="kit-feed__more" role="status">
          <span className="kit-tiny">
            The newest items didn’t load; these are from your last read.
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
          >
            {query.isFetching ? "Reading…" : "Try again"}
          </button>
        </div>
      ) : null}
      {chipsAt ? createPortal(chips, chipsAt) : chips}
      {composer}
      {days.length === 0 ? (
        <p className="kit-week__quiet">
          {newOnly
            ? "Nothing new here since your last visit."
            : show === "close"
              ? "Nothing from your close friends in the last seven days."
              : show === "friends"
                ? "Nothing from your friends in the last seven days."
                : show === "clan"
                  ? "Nothing from your clan in the last seven days."
                  : "Nothing of yours in the last seven days."}
        </p>
      ) : (
        days.map((d) => (
          <section
            key={d.key}
            className="kit-day"
            aria-label={dayHeading(d.at)}
          >
            <h2 className="kit-day__head">{dayHeading(d.at)}</h2>
            <FeedRows
              rows={d.rows}
              openId={openId}
              onToggle={(id) => setOpenId(openId === id ? null : id)}
              below={(it) => (
                <InPlaceEvidence
                  item={it}
                  window={timeline.window}
                  onRefresh={() => {
                    setOpenId(null);
                    query.refetch();
                  }}
                />
              )}
            />
          </section>
        ))
      )}
      {query.hasNextPage ? (
        <div className="kit-feed__more">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            aria-busy={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Reading…" : "More"}
          </button>
          <span className="kit-tiny">
            {query.isFetchNextPageError
              ? "The next items didn’t load. Try again."
              : `${items.length} of ${total.toLocaleString("en-US")} shown`}
          </span>
        </div>
      ) : null}
      <p className="kit-tiny">
        New means it arrived since you last opened your Timeline. Opening it
        changes nothing your connections have read.
        {more > 0 && !query.hasNextPage
          ? ` A busy week: the ${total} newest are shown, and ${more.toLocaleString("en-US")} more this week are not.`
          : ""}
      </p>
    </div>
  );
}

/**
 * "N new" (2026-11-14): floats at the feed's top, taking no room, so the
 * page under it never moves; sticky, so a reader far down still sees it.
 * The tap reads the first page again (the pages past it are let go) and
 * brings the feed's top into view, its focus there for a keyboard.
 */
function NewPill({ count, top }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const label = `${count.toLocaleString("en-US")} new`;
  return (
    <div className="kit-feed__newpill" role="status">
      <button
        type="button"
        className="kit-newpill"
        disabled={busy}
        aria-busy={busy}
        aria-label={`Show ${count.toLocaleString("en-US")} new ${count === 1 ? "item" : "items"}`}
        onClick={async () => {
          setBusy(true);
          try {
            await reloadHomeFeed(queryClient);
          } finally {
            setBusy(false);
          }
          const reduce = window.matchMedia?.(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          top.current?.scrollIntoView?.({
            behavior: reduce ? "auto" : "smooth",
            block: "start",
          });
          top.current?.focus?.({ preventScroll: true });
        }}
      >
        <Icon name="chevron-up" size={16} />
        {label}
      </button>
    </div>
  );
}

/** A quiet week (#1016): why, as far as Elixir knows it, and the next step,
 *  Find, where your battles' and your clan's people wait with why each one
 *  is there. With `suggest`, People to follow sits under it. */
function Quiet({ follows, suggest }) {
  const q = quietFeed(follows);
  return (
    <div className="kit-feed kit-feed--quiet">
      <Empty
        title={q.title}
        titleAs="h2"
        data-quiet={q.key}
        action={
          <Link to="/home/find" className="btn btn--primary">
            Find your people
          </Link>
        }
      >
        {q.body}
      </Empty>
      {suggest ? <PeopleToFollow /> : null}
    </div>
  );
}

/** The same filters wrap when needed; no option hides beyond the edge. */
function FeedFilters({ children }) {
  return <div className="kit-home__filters">{children}</div>;
}

function InPlaceEvidence({ item, window, onRefresh }) {
  const [offset, setOffset] = useState(0);
  const selected = { ...item, window };
  const query = useHomeFeedEvidence({
    evidence_item_id: item.id,
    from: window.from,
    to: window.to,
    expected_evidence_version: item.evidence.version,
    evidence_offset: String(offset),
  });
  if (item.evidence.kind === "session")
    return (
      <SessionGames
        item={item}
        query={query}
        offset={offset}
        setOffset={setOffset}
        onRefresh={onRefresh}
      />
    );
  return (
    <div className="kit-tl__evidence">
      <TimelineEvidence
        selected={selected}
        query={query}
        offset={offset}
        setOffset={setOffset}
        onRefresh={onRefresh}
        underDay
      />
    </div>
  );
}
