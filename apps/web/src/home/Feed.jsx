import { PlayerName } from "@elixir-mcp/ui";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { playerHref } from "../lib/player.js";
import { accountHref, accountOf } from "../lib/account.js";
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
  keepShow,
  keptShow,
  feedSince,
  modeWord,
  quietFeed,
  shownAt,
  timelineDays,
} from "./logic.js";
import { FollowButton } from "./follow.jsx";
import {
  evidenceWord,
  Sitting,
  SITTINGS,
  sessionLink,
  sittingCard,
} from "./Session.jsx";
import { SessionGames } from "./SessionGames.jsx";
import { Cheers } from "./Cheers.jsx";
import { Comments } from "./Comments.jsx";
import { RacePlace } from "./RacePlace.jsx";
import { PeopleToFollow } from "./People.jsx";

/**
 * Home's one feed (slice 7, #765): the last seven days of everyone you
 * follow, your clan and you, newest first, in days. The chips only choose
 * what is shown; the read is the timeline's, so the page's place ("New since
 * your last visit") is the one it always was, and opening Home moves it and
 * nothing a connection has read (standing ruling, 2026-10-20).
 *
 * An item is a sitting with its sparkline, a moment with its battle, a
 * highlight in its player's words, or a clan's line, identified by its band.
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
export function HomeFeed({ chipsAt = null, suggest = false } = {}) {
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
  const circle = useHomeCircle();
  const hasClose = (circle.data?.circle?.friends?.length ?? 0) > 0;
  const chipList = feedChips(hasClose);
  const wanted = picked ?? keptShow(who);
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
        <PlayerName tag={who.tag}>
          <TagText>{who.name ?? who.tag}</TagText>
        </PlayerName>
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
      <span className="kit-mbattle__go">Open the battle</span>
    </Link>
  );
}

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

/** The same filters wrap when needed; no option hides beyond the edge. */
function FeedFilters({ children }) {
  return <div className="kit-home__filters">{children}</div>;
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
  const card = sittingCard(it);
  const sessionTo = card
    ? sessionLink(it, who?.kind === "player" ? who.tag : null)
    : null;
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
      {accountOf(it) ? (
        <Link to={accountHref(accountOf(it))} className="btn btn--sm">
          Open their account
        </Link>
      ) : null}
      {/* A sitting opens its own page (2026-11-16): the card is the
          link. A moment's crossing, and a sitting with no page to open,
          still open in place. */}
      {it.evidence && !sessionTo ? (
        <button
          type="button"
          className="btn btn--sm"
          aria-expanded={open}
          onClick={onToggle}
        >
          {evidenceWord(it, open)}
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
          card={who?.kind === "player" ? (it.avatar_card_id ?? null) : null}
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
      ) : card ? (
        <Sitting
          it={it}
          href={sessionTo}
          who={who?.kind === "player" ? (who.name ?? who.tag) : null}
        />
      ) : (
        text
      )}
      {it.kind === "week_resolved" ? <RacePlace rank={it.facts?.rank} /> : null}
      {moment && it.battle_url ? <MomentBattle it={it} /> : null}
      <footer className="kit-feed__foot">
        {"cheers" in it ? <Cheers it={it} /> : null}
        <span className="share-actions kit-feed__links">{links}</span>
      </footer>
      {"comments" in it ? <Comments it={it} /> : null}
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
