import {
  Disclosure,
  Link,
  useClock,
  MODE_LABEL,
  Tag,
  Panel,
  Table,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useMemberActivity } from "../lib/queries.js";
import { clanPath } from "../lib/base.js";

const number = (v) => (v == null ? "Unknown" : v.toLocaleString());

/** A page cannot assert a complete session: the next page may continue it. */
export function recordedSessions(battles) {
  const sessions = [];
  for (const b of battles) {
    const previous = sessions.at(-1);
    if (
      !previous ||
      Date.parse(previous.at(-1).battle_time) - Date.parse(b.battle_time) >=
        30 * 60_000
    )
      sessions.push([b]);
    else previous.push(b);
  }
  return sessions;
}

export function MemberActivity({
  clan,
  playerTag,
  navigate,
  rosterSearch = "",
}) {
  const { when } = useClock();
  const [pages, setPages] = useState([{ cursor: null, to: null }]);
  const current = pages.at(-1);
  const { state } = useMemberActivity(
    clan.clan_tag,
    playerTag,
    current.cursor,
    current.to,
  );
  const d = state.data;
  const stamp = (at) => (at ? when(at) : "Unknown");
  const head = (
    <>
      <Link
        to={
          `${clanPath(clan.clan_tag)}/roster` +
          (rosterSearch
            ? `?${new URLSearchParams({ find: rosterSearch })}`
            : "")
        }
        navigate={navigate}
      >
        Back to {clan.name ?? "clan"}
      </Link>
      <div className="page-head mt-3">
        <h1 className="page__title">
          {d?.name ?? <Tag tag={playerTag} />} · Activity
        </h1>
        <span className="tag">{playerTag}</span>
      </div>
    </>
  );
  if (!d)
    return (
      <>
        {head}
        {state.forbidden || state.signedOut || state.error ? (
          <div className="callout callout--warn" role="alert">
            <span>
              {state.error === "not_current_member"
                ? "This player is no longer on this clan’s recorded roster."
                : "Activity is unavailable. Check your clan access or try again."}
            </span>
          </div>
        ) : (
          <p className="page__lede">Reading this member’s recorded activity…</p>
        )}
      </>
    );
  const sessions = recordedSessions(d.battles);
  return (
    <>
      {head}
      <p className="page__lede">
        Recorded play for this clan from {stamp(d.window.from)} to{" "}
        {stamp(d.window.to)}. Battle detail is limited to their current time in
        the clan and battles that name this clan.
      </p>
      <div className="callout mb-4" role="note">
        <span>
          No recorded activity does not mean no play. Gaps, and the time since
          their profile was last read, stay unknown.
        </span>
      </div>
      <dl className="grid gap-2 mb-4">
        <div>
          <dt className="label">Last recorded battle in this clan</dt>
          <dd className="m-0">{stamp(d.last_recorded_battle_in_clan)}</dd>
        </div>
        <div>
          <dt className="label">Last seen in game</dt>
          <dd className="m-0">
            {stamp(d.last_seen_in_game)} · the game’s timestamp, separate from
            recorded play
          </dd>
        </div>
        <div>
          <dt className="label">Contribution record as of</dt>
          <dd className="m-0">{stamp(d.as_of)}</dd>
        </div>
      </dl>
      <Panel title="Weekly contributions" titleAs="div" className="mb-4">
        <div className="panel__body">
          <Disclosure title="How weekly contributions are counted">
            <p className="page-head__note">
              Four ISO weeks, including the current partial week, clipped to the
              current time in the clan. Battles must name this clan. Donations
              are the highest count seen for this clan in each week. A join
              inside a week makes its cumulative donation counter unknown here.
              Unknown stays unknown.
            </p>
          </Disclosure>
          <Table
            columns={[
              {
                head: "ISO week",
                cell: (w) => (
                  <>
                    {w.iso_week}
                    {w.partial ? " · partial" : ""}
                    <div className="page-head__note">
                      {stamp(w.from)} – {stamp(w.to)}
                    </div>
                  </>
                ),
              },
              {
                head: "Recorded battles",
                num: true,
                cell: (w) => number(w.battles),
              },
              {
                head: "Path of Legends battles",
                num: true,
                cell: (w) => number(w.ranked_battles),
              },
              {
                head: "Donations",
                num: true,
                cell: (w) => number(w.donations),
              },
            ]}
            rows={d.weeks}
            rowKey={(w) => w.iso_week}
          />
        </div>
      </Panel>
      <Panel title="War usage" titleAs="div" className="mb-4">
        <div className="panel__body">
          <Disclosure title="About war usage">
            <p className="page-head__note">
              Recorded weekly totals; decks cannot reliably be assigned to
              individual war days. A duel can use several decks. War weeks and
              ISO weeks are different windows. A week crossing the current stint
              or read boundary has unknown attribution; its totals are withheld.
            </p>
          </Disclosure>
          {d.war_weeks.length ? (
            <Table
              columns={[
                {
                  head: "War week",
                  cell: (w) => (
                    <>
                      S{w.season_id} W{w.section_index + 1}
                      {w.attribution_unknown ? " · attribution unknown" : ""}
                      {w.is_colosseum
                        ? " · Colosseum"
                        : w.finished_early
                          ? " · clan finished early"
                          : ""}
                    </>
                  ),
                },
                { head: "Decks used", num: true, cell: (w) => number(w.decks) },
                { head: "Points", num: true, cell: (w) => number(w.points) },
              ]}
              rows={d.war_weeks}
              rowKey={(w) => `${w.season_id}-${w.section_index}`}
            />
          ) : (
            <p>No war week recorded in this window.</p>
          )}
        </div>
      </Panel>
      <Panel title="What was read" titleAs="div" className="mb-4">
        <div className="panel__body">
          <Disclosure title="About what was read">
            <p className="page-head__note">
              Spans between two profile reads, ending in the last seven days and
              inside the dates above. They do not show the whole of those dates
              was read, or anything after the last span.
            </p>
          </Disclosure>
          {d.coverage.intervals.length ? (
            <Table
              columns={[
                {
                  head: "Between reads",
                  cell: (i) => (
                    <>
                      {stamp(i.from)} – {stamp(i.to)}
                    </>
                  ),
                },
                {
                  head: "Counter increase",
                  num: true,
                  cell: (i) => number(i.expected_battles),
                },
                {
                  head: "Battles recorded",
                  num: true,
                  cell: (i) => number(i.captured_battles),
                },
                {
                  head: "Comparison",
                  cell: (i) =>
                    i.complete === true
                      ? "Matches counter"
                      : i.complete === false
                        ? "Missing battles"
                        : "Not comparable",
                },
              ]}
              rows={d.coverage.intervals}
              rowKey={(i) => i.to}
            />
          ) : (
            <p>
              {d.coverage.available
                ? "No comparable observation interval is available here. Coverage is unknown."
                : "Coverage could not be read. Battle evidence is still shown; coverage is unknown."}
            </p>
          )}
        </div>
      </Panel>
      <Panel>
        <h2 className="panel__head m-0">
          Recorded sessions · page {pages.length}
        </h2>
        <div className="panel__body">
          <Disclosure title="About recorded groups">
            <p className="page-head__note">
              Adjacent recorded battles less than 30 minutes apart are grouped
              here. Groups cover this page only and may continue on another
              page; gaps can hide play. Each mode stays named separately. Open a
              battle for its existing full detail and session.
            </p>
          </Disclosure>
          {!sessions.length ? (
            <p>
              No clan battles recorded on this page.{" "}
              {d.next_cursor
                ? "There are older records to read."
                : "The bounded record is exhausted."}{" "}
              Gaps stay unknown.
            </p>
          ) : (
            sessions.map((group, index) => (
              <div key={group[0].battle_id} className="mb-4">
                <h3 className="label">
                  Recorded group {index + 1} · {stamp(group.at(-1).battle_time)}{" "}
                  – {stamp(group[0].battle_time)}
                </h3>
                <Table
                  columns={[
                    {
                      head: "Battle",
                      cell: (b) =>
                        b.url ? (
                          <a href={b.url}>{stamp(b.battle_time)}</a>
                        ) : (
                          stamp(b.battle_time)
                        ),
                    },
                    {
                      head: "Mode",
                      cellProps: (b) => ({
                        title: b.game_mode?.name ?? undefined,
                      }),
                      cell: (b) =>
                        MODE_LABEL[b.mode_group] ??
                        b.game_mode?.name ??
                        b.mode_group ??
                        "Unknown",
                    },
                    { head: "Result", cell: (b) => b.outcome ?? "Unknown" },
                    {
                      head: "Crowns",
                      num: true,
                      cell: (b) => (
                        <>
                          {number(b.crowns)} – {number(b.opponent_crowns)}
                        </>
                      ),
                    },
                  ]}
                  rows={group}
                  rowKey={(b) => b.battle_id}
                />
              </div>
            ))
          )}
          <div className="flex gap-2">
            {pages.length > 1 ? (
              <button
                className="btn"
                type="button"
                onClick={() => setPages((p) => p.slice(0, -1))}
              >
                Newer records
              </button>
            ) : null}
            {d.next_cursor ? (
              <button
                className="btn"
                type="button"
                onClick={() =>
                  setPages((p) => [
                    ...p,
                    { cursor: d.next_cursor, to: d.window.to },
                  ])
                }
              >
                Older records
              </button>
            ) : null}
          </div>
        </div>
      </Panel>
    </>
  );
}
