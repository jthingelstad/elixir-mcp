import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Avatar,
  Chip,
  Chips,
  DeckVersus,
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
  useTimelinePlace,
} from "../views/account/timeline-shared.jsx";
import {
  FEED_CHIPS,
  feedShown,
  modeWord,
  shownAt,
  timelineDays,
} from "./logic.js";
import { FollowButton } from "./follow.jsx";
import { Sitting, SITTINGS } from "./Session.jsx";
import { SessionGames } from "./SessionGames.jsx";
import { Cheers } from "./Cheers.jsx";
import { RacePlace } from "./RacePlace.jsx";

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
 *
 * The chips sit in the page's head, right of its title, when the page gives
 * them a place (`chipsAt`, design canvas 2026-11-13), else above the feed.
 * New is one more toggle in the same row, not a second row of chips: on, it
 * keeps only what is new since your last visit, under whichever Show chip.
 */
export function HomeFeed({ chipsAt = null } = {}) {
  const { day, feedDayHeading: dayHeading } = useClock();
  const query = useHomeFeed();
  const pages = query.data?.pages ?? [];
  const timeline = pages[0] ?? null;
  const { openedMs } = useTimelinePlace(timeline);
  const [show, setShow] = useState("everyone");
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
  const shown = feedShown(items, show).filter((it) => !newOnly || isNew(it));
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
  const chips = (
    <div className="kit-home__filters">
      <Chips
        label="Show"
        options={FEED_CHIPS.map((c) => ({ ...c, count: counts[c.key] }))}
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
    </div>
  );
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
      {chipsAt ? createPortal(chips, chipsAt) : chips}
      {days.length === 0 ? (
        <p className="kit-week__quiet">
          {newOnly
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

/** Who an item is about: the player it names, else its clan, else you. */
function subjectOf(it) {
  const player =
    (it.subjects ?? []).find((s) => s.kind === "player") ??
    (it.facts?.player_tag
      ? { tag: it.facts.player_tag, name: it.facts.name ?? null }
      : null);
  if (player) return { ...player, kind: "player" };
  const clan = (it.subjects ?? []).find((s) => s.kind === "clan");
  if (clan) return { ...clan, name: clan.name ?? it.subject_name ?? clan.tag };
  return null;
}

/** Who an item is about, as the feed names them: a player's game name opens
 *  their page; a clan's line names the clan; the account's own items are
 *  yours. Never a nickname here: the sentence below says it the way the
 *  timeline does. */
function Who({ who }) {
  if (who?.kind === "player")
    return (
      <Link to={playerHref(who.tag)} className="kit-feed__name">
        <TagText>{who.name ?? who.tag}</TagText>
      </Link>
    );
  if (who)
    return (
      <span className="kit-feed__name">
        <TagText>{who.name}</TagText>
      </span>
    );
  return <span className="kit-feed__name">You</span>;
}

const isClanLine = (it) =>
  (it.subjects ?? []).length > 0 &&
  (it.subjects ?? []).every((s) => s.kind === "clan");

/** A clan's own item, or a member's coming, going or role in it: these wear
 *  the clan's band and gold edge (canvas .item.clan). */
const CLAN_MEMBER_KINDS = new Set([
  "member_joined",
  "member_left",
  "member_role_changed",
]);
const isClanItem = (it) =>
  isClanLine(it) ||
  (CLAN_MEMBER_KINDS.has(it.kind) &&
    (it.subjects ?? []).some((s) => s.kind === "clan"));

/** The word after the clan's name on its band. */
const BAND_WORDS = {
  member_joined: "arrival",
  member_left: "departure",
  member_role_changed: "role",
  race_finished: "Clan Wars",
  week_resolved: "Clan Wars",
  bracket_observed: "Clan Wars",
};

/** A moment's medal: violet for a card's first, gold for the rest. */
const VIOLET = new Set(["card_unlocked", "card_form_unlocked"]);

/** The facts a moment names its proving battle under, in the feed's order
 *  (services/web-api/src/feed.mjs PROOFS). */
const PROOFS = ["promoted_by", "crossed_by", "best_win"];

/** A moment's battle, as its line under the moment (canvas .mbattle): the
 *  result and score when the record names them, and one way in. */
function MomentBattle({ it }) {
  const by = PROOFS.map((k) => it.facts?.[k]).find((p) => p?.battle_id) ?? null;
  const known =
    by &&
    typeof by.crowns === "number" &&
    typeof by.crowns_against === "number";
  const won = known && by.crowns > by.crowns_against;
  // The line under the result (canvas .mbattle's note): the battle's mode,
  // and its trophies after when the record kept them. Facts only.
  const context = [
    it.proof_mode ? modeWord(it.proof_mode) : null,
    typeof by?.trophies_after === "number" && it.proof_mode === "ladder"
      ? `${by.trophies_after.toLocaleString("en-US")} trophies after`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={it.battle_url.replace(/^https?:\/\/[^/]+/, "")}
      className="kit-mbattle"
    >
      {known ? (
        <>
          <span
            className={`kit-mbattle__res kit-mbattle__res--${won ? "won" : "lost"}`}
          >
            {won ? "Won" : "Lost"}
          </span>
          <span className="kit-mbattle__line">
            <b>
              {by.crowns}-{by.crowns_against}
              {by.opponent?.name ? (
                <>
                  {won ? " over " : " against "}
                  <TagText>{by.opponent.name}</TagText>
                </>
              ) : null}
            </b>
            {context ? (
              <span className="kit-mbattle__note">{context}</span>
            ) : null}
          </span>
        </>
      ) : null}
      <span className="kit-mbattle__go">The battle</span>
    </Link>
  );
}

/** What an item's open button says (design canvas, 2026-11-13): a sitting
 *  opens as a session, a moment's crossing as its crossing. */
const openWord = (it, open) =>
  it.evidence.kind === "session"
    ? open
      ? "Close session"
      : "Open session"
    : open
      ? "Close crossing"
      : "Open crossing";

/** When an item happened, as the feed says it ("Tonight, 7:40 to 8:32 pm"),
 *  with the exact instant for a pointer and a screen reader. A sitting
 *  shows its range. */
function When({ it }) {
  const { feedWhen, when } = useClock();
  const f = it.facts ?? {};
  const range = SITTINGS.has(it.kind) && f.started_at && f.ended_at;
  const at = range ? f.started_at : shownAt(it);
  if (!at) return null;
  return (
    <time
      className="kit-feed__time"
      dateTime={at}
      title={range ? `${when(f.started_at)} to ${when(f.ended_at)}` : when(at)}
    >
      {range ? feedWhen(f.started_at, f.ended_at) : feedWhen(at)}
    </time>
  );
}

function FeedItem({ it, open, onToggle }) {
  const sitting = SITTINGS.has(it.kind);
  const clan = isClanItem(it);
  const who = subjectOf(it);
  const clanSubject = clan
    ? (it.subjects ?? []).find((s) => s.kind === "clan")
    : null;
  const moment = !sitting && !clan && it.kind !== "battle_highlight";
  const band = BAND_WORDS[it.kind];
  const text = (
    <p className="kit-feed__text">
      <TagText>{it.text}</TagText>
    </p>
  );
  const links = (
    <>
      {it.battle_url && !moment ? (
        <Link
          to={it.battle_url.replace(/^https?:\/\/[^/]+/, "")}
          className="btn btn--sm"
        >
          Open battle
        </Link>
      ) : null}
      {it.kind === "battle_highlight" ? (
        <HighlightLinks facts={it.facts} />
      ) : null}
      {it.evidence ? (
        <button
          type="button"
          className="btn btn--sm"
          aria-expanded={open}
          onClick={onToggle}
        >
          {openWord(it, open)}
        </button>
      ) : null}
    </>
  );
  return (
    <article className={`kit-feed__item${clan ? " kit-feed__item--clan" : ""}`}>
      {clanSubject ? (
        <p className="kit-feed__band">
          <Icon name="shield" size={16} />
          <TagText>
            {clanSubject.name ?? it.subject_name ?? clanSubject.tag}
          </TagText>
          {band ? ` · ${band}` : null}
        </p>
      ) : null}
      <header className="kit-feed__head">
        <Avatar
          name={who?.name ?? who?.tag ?? "You"}
          tag={who?.tag}
          clan={who ? who.kind !== "player" : false}
        />
        <div className="kit-feed__who">
          <Who who={who} />
          <When it={it} />
        </div>
        {it.offer_follow && who?.kind === "player" ? (
          // A clan arrival you do not follow (canvas .ih .follow): the one
          // Follow, asked first, priced when its dialog opens.
          <FollowButton tag={who.tag} name={who.name} lazy />
        ) : null}
      </header>
      {it.kind === "battle_highlight" ? (
        <HighlightBody it={it} who={who} />
      ) : moment ? (
        <div className="kit-feed__moment">
          <span
            className={`kit-medal${VIOLET.has(it.kind) ? " kit-medal--violet" : ""}`}
            aria-hidden="true"
          >
            <Icon name="star" size={26} />
          </span>
          {text}
        </div>
      ) : (
        text
      )}
      {it.kind === "week_resolved" ? <RacePlace rank={it.facts?.rank} /> : null}
      {sitting ? <Sitting it={it} /> : null}
      {moment && it.battle_url ? <MomentBattle it={it} /> : null}
      <footer className="kit-feed__foot">
        {"cheers" in it ? <Cheers it={it} /> : null}
        <span className="share-actions kit-feed__links">{links}</span>
      </footer>
    </article>
  );
}

/** A highlight as the canvas draws it: what happened, the player's own
 *  words on the gold rule, and both decks with the score between when the
 *  record kept them (`versus`, built with the highlight's read). */
function HighlightBody({ it, who }) {
  const f = it.facts ?? {};
  const b = f.battle ?? {};
  const words = String(f.words ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = words ? `: “${words}”` : "";
  const said =
    suffix && it.text?.endsWith(suffix)
      ? `${it.text.slice(0, -suffix.length)}.`
      : it.text;
  const v = it.versus;
  const known =
    typeof b.crowns === "number" && typeof b.crowns_against === "number";
  const result =
    b.outcome === "win" ? "Won" : b.outcome === "loss" ? "Lost" : null;
  const theirName = b.opponents?.length === 1 ? b.opponents[0].name : null;
  return (
    <>
      <p className="kit-feed__text">
        <TagText>{said}</TagText>
      </p>
      {said !== it.text ? (
        <blockquote className="kit-feed__words">
          <TagText>{words}</TagText>
        </blockquote>
      ) : null}
      {v?.mine && v?.theirs && known ? (
        <DeckVersus
          showCost
          left={{
            name: <TagText>{who?.name ?? who?.tag ?? "You"}</TagText>,
            label: v.mine.label ? <TagText>{v.mine.label}</TagText> : null,
            cards: v.mine.cards,
          }}
          right={{
            name: <TagText>{theirName ?? "Their deck"}</TagText>,
            label: v.theirs.label ? <TagText>{v.theirs.label}</TagText> : null,
            cards: v.theirs.cards,
          }}
          score={`${b.crowns}-${b.crowns_against}`}
          scoreLabel={`${result ? `${result} ` : ""}${b.crowns} to ${b.crowns_against}`}
          note={b.mode_group ? modeWord(b.mode_group) : null}
        />
      ) : null}
    </>
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
        <Link to={battle} className="btn btn--sm">
          Open battle
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
