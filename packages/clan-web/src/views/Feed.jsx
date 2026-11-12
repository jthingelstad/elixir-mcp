import { useState } from "react";
import { Empty, Link, Panel, TagText, useClock } from "@elixir-mcp/ui";
import { CLAN, clanPath } from "../lib/base.js";
import { useActions, useFeed, useMemberView, useWeek } from "../lib/queries.js";
import { ActionsNow, WeekCard, YouCard } from "./Waiting.jsx";

/** A battle's own page on this origin, or null: the record serves the
 *  absolute address, and the Feed links it in place. */
const battlePath = (url) => {
  const path = String(url ?? "").replace(/^https?:\/\/[^/]+/, "");
  return path.startsWith("/battle/") ? path : null;
};

/** How many of the feed's lines show at first, and how many more each More
 *  shows: a busy week was 150 lines, 8,600 px of page (G3). */
export const FEED_PAGE = 30;

/** Whether a gated read has answered, either way. */
const settled = (state) =>
  Boolean(state.data || state.error || state.forbidden || state.signedOut);

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
 *  at a time. It reads once `enabled`: the Feed holds it until the reads
 *  above and beside it have answered, so they never wait behind it. */
function ClanTimeline({ clan, enabled = true }) {
  const { dayHeading, clock } = useClock();
  const { state } = useFeed(clan.clan_tag, enabled);
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
 * The timeline is the heavy read. Asked at once beside the others it slowed
 * every one of them until all four timed out together (2026-11-12, G3), so
 * it starts only once what waits for you, You here and This week have
 * answered. Those reads are shared with the cards through their query keys.
 */
export function Feed({ clan, who, closedOpen, navigate }) {
  const base = clanPath(clan.clan_tag);
  const actions = useActions(clan.clan_tag).state;
  const you = useMemberView(clan.clan_tag).state;
  const week = useWeek(clan.clan_tag, null).state;
  const ready = settled(actions) && settled(you) && settled(week);
  return (
    <>
      <h2 className="sr-only">Feed</h2>
      <div className="clan-today">
        <div className="clan-today__waiting">
          <div className="clan-today__now">
            <ActionsNow
              clan={clan}
              who={who}
              closedOpen={closedOpen}
              navigate={navigate}
            />
          </div>
          <div className="clan-today__timeline">
            <ClanTimeline clan={clan} enabled={ready} />
          </div>
        </div>
        <div className="clan-today__cards">
          <YouCard clan={clan} base={base} navigate={navigate} />
          <WeekCard clan={clan} base={base} navigate={navigate} />
        </div>
      </div>
    </>
  );
}
