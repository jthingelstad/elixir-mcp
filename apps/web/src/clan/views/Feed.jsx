import { useState } from "react";
import {
  Link,
  Chips,
  Empty,
  Skeleton,
  useClock,
  ErrorState,
} from "@elixir-mcp/ui";
import { useMe } from "../../App.jsx";
import { FeedRows } from "../../home/FeedItem.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { keys, useFeed, useRace } from "../lib/queries.js";
import { n, ordinal } from "../lib/words.js";
import { ActionsNow, WeekCard, YouCard } from "./Waiting.jsx";

/** How many of the feed's lines show at first, and how many more each More
 *  shows: a busy week was 150 lines, 8,600 px of page (G3). */
const FEED_PAGE = 30;

/** The items grouped by the reader's day, newest first, as Home draws its
 *  timeline: each day's rows in the Timeline's own shape (FeedRows). */
function byDay(items, dayHeading) {
  const days = [];
  for (const it of items) {
    const head = it.at ? dayHeading(it.at) : "";
    const last = days.at(-1);
    const row = { it, isNew: false, newLine: false };
    if (last && last.head === head) last.rows.push(row);
    else days.push({ head, rows: [row] });
  }
  return days;
}

/** The clan's timeline: its items, its members' moments and posts,
 *  newest first, as this reader reads them (`GET .../feed`), thirty items
 *  at a time, drawn by the Timeline's own components (2026-11-17) so the
 *  two use the same interactions on each item. */
function ClanTimeline({ clan }) {
  const { dayHeading, when } = useClock();
  const { me } = useMe();
  const questionsOn =
    me?.features?.posts === true && me?.features?.comments === true;
  const [view, setView] = useState("all");
  const { state, load } = useFeed(clan.clan_tag, view);
  const [shown, setShown] = useState(FEED_PAGE);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const head = (
    <h3 id="feed-timeline" className="sr-only">
      The clan's Timeline, the last seven days
    </h3>
  );
  const controls = (
    <Chips
      label="Clan Timeline"
      value={view}
      options={[
        { key: "all", label: "All activity" },
        { key: "news", label: "Clan news" },
        ...(questionsOn
          ? [
              {
                key: "questions",
                label: "Questions",
                count: state.data?.question_counts?.questions,
              },
              {
                key: "unanswered",
                label: "Unanswered",
                count: state.data?.question_counts?.unanswered,
              },
            ]
          : []),
      ]}
      onChange={(next) => {
        setView(next);
        setShown(FEED_PAGE);
      }}
    />
  );
  if (state.error || state.forbidden)
    return (
      <section aria-labelledby="feed-timeline" className="grid gap-3">
        {head}
        {controls}
        <ErrorState
          title="The clan’s timeline could not be read just now"
          onRetry={() => load()}
          busy={state.loading}
        >
          Try again in a moment.
        </ErrorState>
      </section>
    );
  const d = state.data;
  if (!d)
    return (
      <section aria-labelledby="feed-timeline" className="grid gap-3">
        {head}
        {controls}
        <Skeleton rows={4} label="Reading the clan’s week" />
      </section>
    );
  const all = d.items ?? [];
  const items = all.slice(0, shown);
  const left = all.length - items.length;
  return (
    <section aria-labelledby="feed-timeline" className="grid gap-3">
      {head}
      {controls}
      {view === "news" ? (
        <p className="page-head__note m-0">
          Joins, departures, role changes, races and the clan's own notices.
        </p>
      ) : null}
      {d.memories?.length ? (
        <section className="panel">
          <h3 className="panel__head">The clan’s week</h3>
          <ul>
            {d.memories.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {d.tournaments?.map((t) => (
            <details key={t.tag}>
              <summary>Recorded games in {t.tag}</summary>
              <ul>
                {t.games.map((g) => (
                  <li key={g.url}>
                    <Link to={g.url}>{when(g.at)}</Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ) : null}
      {items.length === 0 && d.memories?.length ? null : items.length === 0 ? (
        <Empty
          title={
            view === "unanswered"
              ? "No unanswered questions in the last seven days"
              : view === "questions"
                ? "No questions in the last seven days"
                : view === "news"
                  ? "No clan news in the last seven days"
                  : "Nothing in the last seven days"
          }
        >
          {view === "unanswered"
            ? "Questions stay here until their author marks them Answered."
            : view === "questions"
              ? "Questions from your current clanmates appear here."
              : view === "news"
                ? "All activity still shows your clanmates' moments and posts."
                : "Joins, departures, promotions, members' moments and posts appear here as Elixir records them."}
        </Empty>
      ) : (
        <div className="kit-feed">
          {byDay(items, dayHeading).map((day) => (
            <section
              key={day.head || "undated"}
              className="kit-day"
              aria-label={day.head || undefined}
            >
              {day.head ? <h4 className="kit-day__head">{day.head}</h4> : null}
              <FeedRows
                rows={day.rows}
                cheerWhere={{
                  key: keys.feed(clan.clan_tag, view),
                  list: "items",
                }}
              />
            </section>
          ))}
        </div>
      )}
      {left > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setShown((n) => n + FEED_PAGE)}
          >
            More
          </button>
          <span className="page-head__note">
            {items.length} of {all.length.toLocaleString("en-US")} shown
          </span>
        </div>
      ) : null}
      {left === 0 && d.more > 0 ? (
        <p className="page-head__note m-0">
          A busy week: the {all.length} newest{" "}
          {view === "news"
            ? "clan news"
            : view === "questions" || view === "unanswered"
              ? "question"
              : "activity"}{" "}
          items were read, and {Number(d.more).toLocaleString("en-US")} more are
          not.
        </p>
      ) : null}
    </section>
  );
}

/** "Monday about 4:00 am": a nominal instant the game reaches in the half
 *  hour before it, in the reader's zone (UTC, said so, with none). */
function aboutAt(ts, { dayHeading, clock, zone }) {
  if (!ts) return null;
  const day = dayHeading(ts).split(",")[0];
  return `${day} about ${clock(ts)}${zone ? "" : " UTC"}`;
}

/**
 * The race panel beside the Timeline (below it on phones): which day it is, the
 * clan's war decks this race week against four a war day for each member
 * so far (weekly, never a day's split: DECISIONS, "War facts are weekly
 * aggregates"), the clan's place of the clans and its fame, and when the
 * race closes. Nothing between races or while the read has not answered.
 */
export function RaceBar({ race }) {
  const time = useClock();
  if (!race) return null;
  const name = race.is_colosseum ? "Colosseum" : "Clan Wars";
  if (race.day_kind === "training") {
    const opens = aboutAt(race.war_day_opens_at, time);
    return (
      <section className="clan-race" aria-label="This week's race">
        <p className="clan-race__head m-0">{name} · training days</p>
        {opens ? (
          <p className="clan-race__line m-0">The race opens {opens}</p>
        ) : null}
      </section>
    );
  }
  const decks = race.decks ?? null;
  const day = race.finished
    ? "race finished"
    : race.war_day
      ? `race open, day ${race.war_day} of 4`
      : "race open";
  const closes = race.finished ? null : aboutAt(race.closes_at, time);
  const line = [
    race.place && race.clans
      ? `${ordinal(race.place)} of ${race.clans} clans${race.finished ? "" : " so far"}`
      : race.clans
        ? `${race.clans} clans in the race`
        : null,
    race.fame > 0 ? `${n(race.fame)} fame` : null,
    closes ? `the race closes ${closes}` : null,
  ].filter(Boolean);
  return (
    <section className="clan-race" aria-label="This week's race">
      <div className="clan-race__top">
        <p className="clan-race__head m-0">
          {name} · {day}
        </p>
        {decks ? (
          <p className="clan-race__decks m-0">
            {n(decks.used)} of {n(decks.asked)} war decks this week
          </p>
        ) : null}
      </div>
      {decks ? (
        <progress
          className="clan-race__bar"
          value={Math.min(decks.used, decks.asked)}
          max={decks.asked}
          aria-label={`${n(decks.used)} of ${n(decks.asked)} war decks this week`}
        />
      ) : null}
      {line.length ? (
        <p className="clan-race__line m-0">{line.join(" · ")}</p>
      ) : null}
    </section>
  );
}

/**
 * Timeline, Clan's first tab for everyone (the route stays /feed): what
 * waits for you first, then the clan's Timeline, with the race, you in
 * this clan and the clan's week in a side column beside them (on a
 * phone, after the timeline, as Home's: 2026-11-13). Run holds the leaders'
 * Waiting and Decided; an action waiting for a leader is in both.
 *
 * Every panel asks for its read at once. The timeline waited for the others
 * from 2026-11-12 (G3), when it walked every battle the record learned in
 * the week; since 2026-11-13 it reads the clan's own rows, in the same cost
 * class as the panels beside it, so the wait was a round trip for nothing.
 */
export function Feed({ clan, who, navigate }) {
  const base = clanPath(clan.clan_tag);
  const race = useRace(clan.clan_tag).state;
  return (
    <>
      <h2 className="sr-only">Timeline</h2>
      <div className="clan-today">
        <div className="clan-today__waiting">
          <div className="clan-today__now">
            <ActionsNow clan={clan} who={who} navigate={navigate} />
          </div>
          <ClanTimeline key={clan.clan_tag} clan={clan} />
        </div>
        <div className="clan-today__cards">
          <RaceBar race={race.data?.race ?? null} />
          <WeekCard clan={clan} base={base} navigate={navigate} />
          <YouCard clan={clan} base={base} navigate={navigate} />
        </div>
      </div>
    </>
  );
}
