import { useMemo, useState } from "react";
import {
  Chips,
  Empty,
  ErrorState,
  Link,
  Icon,
  TagText,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { SETTINGS } from "../lib/settings.js";
import { playerHref } from "../lib/player.js";
import { useHomeFeed, useHomeFeedEvidence } from "../lib/queries.js";
import {
  TimelineEvidence,
  useRowTime,
  useTimelinePlace,
} from "../views/account/timeline-shared.jsx";
import { FEED_CHIPS, feedShown, shownAt, timelineDays } from "./logic.js";
import { evidenceWord, Sitting, SITTINGS } from "./Session.jsx";
import { Cheers } from "./Cheers.jsx";

/**
 * Home's one feed (slice 7, #765): the last seven days of everyone you
 * follow, your clan and you, newest first, in days. The chips only choose
 * what is shown; the read is the timeline's, so the page's place ("New since
 * your last visit") is the one it always was, and opening Home moves it and
 * nothing a connection has read (standing ruling, 2026-10-20).
 *
 * An item is a sitting with its sparkline, a moment with its battle, a
 * highlight in its player's words, or a clan's line, which wears the gold
 * edge. Every player's name opens their page, and every item carries its
 * cheers (Cheers.jsx). Your account's own lines (claims, recording started
 * or stopped) are not here: the read leaves them out and the bell tells
 * them (2026-11-12).
 *
 * Thirty items a page, and More for the next thirty of the same week (G1,
 * 2026-11-12: a busy week was 150 items, 15 to 25 s to read and 20,870 px
 * of page). The chips count the whole week; they show what is loaded.
 */
export function HomeFeed() {
  const { day, dayHeading } = useClock();
  const query = useHomeFeed();
  const pages = query.data?.pages ?? [];
  const timeline = pages[0] ?? null;
  const { openedMs } = useTimelinePlace(timeline);
  const [show, setShow] = useState("everyone");
  const [state, setState] = useState("all");
  const [openId, setOpenId] = useState(null);
  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p?.timeline ?? []),
    [query.data],
  );
  const isNew = (it) =>
    openedMs !== null && Date.parse(it.observed_at ?? it.at) > openedMs;
  // Q8 keeps the State chips; the four Show chips replace its Who chips
  // (Jamie, 2026-11-12).
  const shown = feedShown(items, show).filter(
    (it) => state === "all" || isNew(it),
  );
  const more = timeline?.timeline_more ?? 0;
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
        title="Your feed didn’t load"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
        retryLabel="Try again"
      >
        It took too long or the connection dropped. Nothing was lost.
      </ErrorState>
    );
  if (items.length === 0)
    return (
      <Empty
        title="Nothing in the last seven days"
        action={
          <Link to={`${SETTINGS}/players`} className="btn btn--sm">
            Choose who you follow
          </Link>
        }
      >
        Everyone you follow, your clan and you appear here while their notify
        switch is on.
      </Empty>
    );
  const days = timelineDays(shown, { day, openedMs });
  // The week's counts, from the first page; what is loaded, if it has none.
  const counts = Object.fromEntries(
    FEED_CHIPS.map((c) => [
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
  return (
    <div className="kit-feed">
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
      <div className="kit-home__filters">
        <Chips
          label="Show"
          options={FEED_CHIPS.map((c) => ({ ...c, count: counts[c.key] }))}
          value={show}
          onChange={setShow}
        />
        {openedMs !== null ? (
          <Chips
            label="State"
            options={[
              { key: "all", label: "All" },
              { key: "new", label: "New", count: newCount },
            ]}
            value={state}
            onChange={setState}
          />
        ) : null}
      </div>
      {days.length === 0 ? (
        <p className="kit-week__quiet">
          {state === "new"
            ? "Nothing new here since your last visit."
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
            {d.rows.map(({ it, newLine }, i) => (
              <div key={it.id ?? `${d.key}-${i}`}>
                <FeedItem
                  it={it}
                  open={openId === it.id}
                  onToggle={() => setOpenId(openId === it.id ? null : it.id)}
                />
                {openId === it.id ? (
                  <InPlaceEvidence
                    item={it}
                    window={timeline.window}
                    onRefresh={() => {
                      setOpenId(null);
                      query.refetch();
                    }}
                  />
                ) : null}
                {newLine ? (
                  <div className="kit-newmark">
                    New since your last visit
                    <span className="sr-only">
                      : the items above this line.
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
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
        New means learned since you last opened Home. Opening it changes nothing
        your connections have read.
        {more > 0 && !query.hasNextPage
          ? ` A busy week: the ${total} newest are shown, and ${more.toLocaleString("en-US")} more this week are not.`
          : ""}
      </p>
    </div>
  );
}

/** Who an item is about, as the feed names them: a player's game name opens
 *  their page; a clan's line names the clan; the account's own items are
 *  yours. Never a nickname here: the sentence below says it the way the
 *  timeline does. */
function Who({ it }) {
  const player =
    (it.subjects ?? []).find((s) => s.kind === "player") ??
    (it.facts?.player_tag
      ? { tag: it.facts.player_tag, name: it.facts.name ?? null }
      : null);
  if (player)
    return (
      <Link to={playerHref(player.tag)} className="kit-feed__name">
        <TagText>{player.name ?? player.tag}</TagText>
      </Link>
    );
  const clan = (it.subjects ?? []).find((s) => s.kind === "clan");
  if (clan)
    return (
      <span className="kit-feed__name">
        <TagText>{clan.name ?? it.subject_name ?? clan.tag}</TagText>
      </span>
    );
  return <span className="kit-feed__name">You</span>;
}

const isClanLine = (it) =>
  (it.subjects ?? []).length > 0 &&
  (it.subjects ?? []).every((s) => s.kind === "clan");

function FeedItem({ it, open, onToggle }) {
  const rowTime = useRowTime();
  const sitting = SITTINGS.has(it.kind);
  return (
    <article
      className={`kit-feed__item${isClanLine(it) ? " kit-feed__item--clan" : ""}`}
    >
      <header className="kit-feed__head">
        <Who it={it} />
        <span className="kit-feed__time">{rowTime(shownAt(it))}</span>
      </header>
      <p className="kit-feed__text">
        <TagText>{it.text}</TagText>
      </p>
      {sitting ? <Sitting it={it} /> : null}
      <span className="share-actions">
        {it.battle_url ? (
          <Link
            to={it.battle_url.replace(/^https?:\/\/[^/]+/, "")}
            className="link kit-tl__more"
          >
            The battle
          </Link>
        ) : null}
        {it.kind === "battle_highlight" ? (
          <HighlightLinks facts={it.facts} />
        ) : null}
        {it.evidence ? (
          <button
            type="button"
            className="link kit-tl__more"
            aria-expanded={open}
            onClick={onToggle}
          >
            {evidenceWord(it, open)}
          </button>
        ) : null}
      </span>
      {"cheers" in it ? <Cheers it={it} /> : null}
    </article>
  );
}

/** A highlight's row (#762): its battle, and its share link when it is
 *  yours and shared (the server sends share_url to its owner only). */
function HighlightLinks({ facts }) {
  const [copied, flash] = useFlash();
  const battle = String(facts?.battle?.url ?? "").replace(
    /^https?:\/\/[^/]+/,
    "",
  );
  return (
    <>
      {battle.startsWith("/battle/") ? (
        <Link to={battle} className="link kit-tl__more">
          Open the battle
        </Link>
      ) : null}
      {facts?.share_url ? (
        <button
          type="button"
          className="link kit-tl__more"
          onClick={() => {
            navigator.clipboard?.writeText(facts.share_url);
            flash();
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy share link"}
        </button>
      ) : null}
    </>
  );
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
