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
import { useMyTimeline, useTimelineEvidence } from "../lib/queries.js";
import {
  TimelineEvidence,
  useRowTime,
  useTimelinePlace,
} from "../views/account/timeline-shared.jsx";
import {
  FEED_CHIPS,
  feedShown,
  modeWord,
  shownAt,
  timelineDays,
} from "./logic.js";
import { Sparkline } from "./Sparkline.jsx";

/**
 * Home's one feed (slice 7, #765): the last seven days of everyone you
 * follow, your clan and you, newest first, in days. The chips only choose
 * what is shown; the read is the timeline's, so the page's place ("New since
 * your last visit") is the one it always was, and opening Home moves it and
 * nothing a connection has read (standing ruling, 2026-10-20).
 *
 * An item is a sitting with its sparkline, a moment with its battle, a
 * highlight in its player's words, or a clan's line, which wears the gold
 * edge. Every player's name opens their page.
 */
export function HomeFeed() {
  const { day, dayHeading } = useClock();
  const query = useMyTimeline();
  const timeline = query.data ?? null;
  const { openedMs } = useTimelinePlace(timeline);
  const [show, setShow] = useState("everyone");
  const [state, setState] = useState("all");
  const [openId, setOpenId] = useState(null);
  const items = useMemo(() => timeline?.timeline ?? [], [timeline]);
  const isNew = (it) =>
    openedMs !== null && Date.parse(it.observed_at ?? it.at) > openedMs;
  // Q8 keeps the State chips; the four Show chips replace its Who chips
  // (Jamie, 2026-11-12).
  const shown = feedShown(items, show).filter(
    (it) => state === "all" || isNew(it),
  );
  const more = timeline?.timeline_more ?? 0;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError)
    return (
      <ErrorState
        title="Your feed could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
        retryLabel="Refresh feed"
      >
        Try again shortly. Nothing was lost.
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
  const counts = Object.fromEntries(
    FEED_CHIPS.map((c) => [c.key, feedShown(items, c.key).length]),
  );
  const newCount = items.filter(isNew).length;
  return (
    <div className="kit-feed">
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
      <p className="kit-tiny">
        New means learned since you last opened Home. Opening it changes nothing
        your connections have read.
        {more > 0
          ? ` A busy week: the ${items.length} newest are shown, and ${more.toLocaleString("en-US")} more this week are not.`
          : ""}
      </p>
    </div>
  );
}

const SITTINGS = new Set(["battle_session", "session_standout"]);

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
            {open ? closeWord(it) : openWord(it)}
          </button>
        ) : null}
      </span>
    </article>
  );
}

/** A sitting's numbers and its sparkline: battles, won, lost and, on
 *  Trophy Road, the trophies it moved; the deck it was played with most. */
function Sitting({ it }) {
  const f = it.facts ?? {};
  const modes = Object.keys(f.by_mode ?? {});
  const trophies =
    typeof f.trophy_net === "number" && (f.by_mode?.ladder ?? 0) > 0
      ? `${f.trophy_net > 0 ? "+" : ""}${f.trophy_net} trophies`
      : null;
  const line = [
    `${f.battles ?? 0} battles`,
    `${f.won ?? 0} won`,
    `${f.lost ?? 0} lost`,
    trophies,
    modes.length === 1 ? modeWord(modes[0]) : null,
    f.decks?.[0]?.label ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="kit-feed__sitting">
      <Sparkline spark={it.spark} />
      <span className="kit-tiny">
        <TagText>{line}</TagText>
      </span>
    </div>
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

const openWord = (it) =>
  it.evidence.kind === "session" ? "View games" : "View crossing";
const closeWord = (it) =>
  it.evidence.kind === "session" ? "Close games" : "Close crossing";

function InPlaceEvidence({ item, window, onRefresh }) {
  const [offset, setOffset] = useState(0);
  const selected = { ...item, window };
  const query = useTimelineEvidence({
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
