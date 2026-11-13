import { useState } from "react";
import { Empty, Link, Panel, TagText, useClock } from "@elixir-mcp/ui";
import { CLAN, clanPath } from "../lib/base.js";
import { useFeed, useRace } from "../lib/queries.js";
import { n, ordinal } from "../lib/words.js";
import { ActionsNow, WeekCard, YouCard } from "./Waiting.jsx";

/** A battle's own page on this origin, or null: the record serves the
 *  absolute address, and the Feed links it in place. */
const battlePath = (url) => {
  const path = String(url ?? "").replace(/^https?:\/\/[^/]+/, "");
  return path.startsWith("/battle/") ? path : null;
};

/** How many of the feed's lines show at first, and how many more each More
 *  shows: a busy week was 150 lines, 8,600 px of page (G3). */
const FEED_PAGE = 30;

/** The items grouped by the reader's day, newest first, as Home draws its
 *  timeline. */
function byDay(items, dayHeading) {
  const days = [];
  for (const it of items) {
    const head = it.at ? dayHeading(it.at) : "";
    const last = days.at(-1);
    if (last && last.head === head) last.items.push(it);
    else days.push({ head, items: [it] });
  }
  return days;
}

/** The clan's timeline: its items, its members' moments and highlights,
 *  newest first, as this reader reads them (`GET .../feed`), thirty lines
 *  at a time. */
function ClanTimeline({ clan }) {
  const { dayHeading, clock } = useClock();
  const { state } = useFeed(clan.clan_tag);
  const [shown, setShown] = useState(FEED_PAGE);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const head = (
    <h3 id="feed-timeline" className="label m-0">
      The clan, the last seven days
    </h3>
  );
  if (state.error || state.forbidden)
    return (
      <section aria-labelledby="feed-timeline" className="grid gap-2">
        {head}
        <p className="m-0 text-ink-dim" role="alert">
          The clan&rsquo;s timeline could not be read just now. Try again in a
          minute.
        </p>
      </section>
    );
  const d = state.data;
  if (!d)
    return (
      <section aria-labelledby="feed-timeline" className="grid gap-2">
        {head}
        <p className="m-0 text-ink-dim">Reading the clan&rsquo;s week…</p>
      </section>
    );
  const all = d.items ?? [];
  const items = all.slice(0, shown);
  const left = all.length - items.length;
  return (
    <section aria-labelledby="feed-timeline" className="grid gap-2">
      {head}
      {items.length === 0 ? (
        <Empty title="Nothing in the last seven days">
          Joins, departures, promotions, members&rsquo; moments and highlights
          appear here as Elixir records them.
        </Empty>
      ) : (
        <Panel pad>
          {byDay(items, dayHeading).map((day) => (
            <section key={day.head || "undated"} className="kit-day">
              {day.head ? <h4 className="kit-day__head">{day.head}</h4> : null}
              <ul className="m-0 list-none p-0">
                {day.items.map((it, i) => {
                  const battle = battlePath(it.battle_url);
                  return (
                    <li
                      key={it.id ?? `${day.head}-${i}`}
                      className="kit-row kit-tl"
                    >
                      <span className="kit-row__main">
                        <span className="kit-row__title">
                          <TagText>{it.text}</TagText>
                        </span>
                        {it.kind === "battle_highlight" && it.words ? (
                          <span className="kit-row__detail">
                            &ldquo;{it.words}&rdquo;
                          </span>
                        ) : null}
                        {battle ? (
                          <Link to={battle} className="link kit-tl__more">
                            Open the battle
                          </Link>
                        ) : null}
                      </span>
                      <span className="kit-row__right">
                        {it.at ? clock(it.at) : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Panel>
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
          A busy week: the {all.length} newest are shown, and{" "}
          {Number(d.more).toLocaleString("en-US")} more are not.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Feed, Clan's first tab for everyone (Clan as one view, slice 8, #766; it
 * replaced Today): what waits for you first, then the clan's timeline, with
 * you in this clan and the clan's week in a side column beside them (on a
 * phone, above the timeline). Run holds the leaders' Waiting and Decided; an
 * action waiting for a leader is in both.
 *
 * Every panel asks for its read at once. The timeline waited for the others
 * from 2026-11-12 (G3), when it walked every battle the record learned in
 * the week; since 2026-11-13 it reads the clan's own rows, in the same cost
 * class as the panels beside it, so the wait was a round trip for nothing.
 */
/** "Monday about 4:00 am": a nominal instant the game reaches in the half
 *  hour before it, in the reader's zone (UTC, said so, with none). */
function aboutAt(ts, { dayHeading, clock, zone }) {
  if (!ts) return null;
  const day = dayHeading(ts).split(",")[0];
  return `${day} about ${clock(ts)}${zone ? "" : " UTC"}`;
}

/**
 * The race bar on top of the Feed (G5): which day of the race it is, the
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

export function Feed({ clan, who, navigate }) {
  const base = clanPath(clan.clan_tag);
  const race = useRace(clan.clan_tag).state;
  return (
    <>
      <h2 className="sr-only">Feed</h2>
      <div className="clan-today">
        <div className="clan-today__waiting">
          <RaceBar race={race.data?.race ?? null} />
          <div className="clan-today__now">
            <ActionsNow clan={clan} who={who} navigate={navigate} />
          </div>
          <div className="clan-today__timeline">
            <ClanTimeline clan={clan} />
          </div>
        </div>
        <div className="clan-today__cards">
          <WeekCard clan={clan} base={base} navigate={navigate} />
          <YouCard clan={clan} base={base} navigate={navigate} />
        </div>
      </div>
    </>
  );
}
