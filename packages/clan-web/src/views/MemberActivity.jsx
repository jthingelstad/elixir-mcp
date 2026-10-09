import { Link, useClock, MODE_LABEL, Tag } from "@elixir-mcp/ui";
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
  const { zone: askedZone } = useClock();
  const zone = askedZone ?? "UTC";
  const [pages, setPages] = useState([{ cursor: null, to: null }]);
  const current = pages.at(-1);
  const { state } = useMemberActivity(
    clan.clan_tag,
    playerTag,
    current.cursor,
    current.to,
  );
  const d = state.data;
  const stamp = (at) =>
    at
      ? new Date(at).toLocaleString(undefined, {
          timeZone: zone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Unknown";
  const head = (
    <>
      <Link
        to={
          clanPath(clan.clan_tag) +
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
        {stamp(d.window.to)} ({zone}). Battle detail is limited to the current
        observed stint and battles that name this clan.
      </p>
      <div className="callout mb-4" role="note">
        <span>
          No recorded activity is not proof of inactivity. Missing capture and
          time after the latest profile observation remain unknown. This view
          does not decide a recommendation.
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
      <section className="panel mb-4">
        <h2 className="panel__head m-0">Weekly contributions</h2>
        <div className="panel__body">
          <p className="page-head__note">
            Four ISO weeks, including the current partial week, clipped to the
            current observed stint. Battles must name this clan. Donations are
            the highest counter observed for this clan in each week. A join
            inside a week makes its cumulative donation counter unknown here.
            Unknown stays unknown.
          </p>
          <div className="table__scroll" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>ISO week</th>
                  <th>Recorded battles</th>
                  <th>Ranked battles</th>
                  <th>Donations</th>
                </tr>
              </thead>
              <tbody>
                {d.weeks.map((w) => (
                  <tr key={w.iso_week}>
                    <td>
                      {w.iso_week}
                      {w.partial ? " · partial" : ""}
                      <div className="page-head__note">
                        {stamp(w.from)} – {stamp(w.to)}
                      </div>
                    </td>
                    <td>{number(w.battles)}</td>
                    <td>{number(w.ranked_battles)}</td>
                    <td>{number(w.donations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="panel mb-4">
        <h2 className="panel__head m-0">War usage</h2>
        <div className="panel__body">
          <p className="page-head__note">
            Recorded weekly totals; decks cannot reliably be assigned to
            individual war days. A duel can use several decks. War weeks and ISO
            weeks are different windows. A week crossing the current stint or
            read boundary has unknown attribution; its totals are withheld.
          </p>
          {d.war_weeks.length ? (
            <div className="table__scroll" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th>War week</th>
                    <th>Decks used</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {d.war_weeks.map((w) => (
                    <tr key={`${w.season_id}-${w.section_index}`}>
                      <td>
                        S{w.season_id} W{w.section_index + 1}
                        {w.attribution_unknown ? " · attribution unknown" : ""}
                        {w.is_colosseum
                          ? " · Colosseum"
                          : w.finished_early
                            ? " · clan finished early"
                            : ""}
                      </td>
                      <td>{number(w.decks)}</td>
                      <td>{number(w.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No war week recorded in this window.</p>
          )}
        </div>
      </section>
      <section className="panel mb-4">
        <h2 className="panel__head m-0">Capture evidence</h2>
        <div className="panel__body">
          <p className="page-head__note">
            Profile-counter intervals ending in the last seven days, restricted
            to the displayed window. These intervals do not prove coverage of
            the whole window or of the time after the latest interval.
          </p>
          {d.coverage.intervals.length ? (
            <div className="table__scroll" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Observation interval</th>
                    <th>Counter increase</th>
                    <th>Battles captured</th>
                    <th>Comparison</th>
                  </tr>
                </thead>
                <tbody>
                  {d.coverage.intervals.map((i) => (
                    <tr key={i.to}>
                      <td>
                        {stamp(i.from)} – {stamp(i.to)}
                      </td>
                      <td>{number(i.expected_battles)}</td>
                      <td>{number(i.captured_battles)}</td>
                      <td>
                        {i.complete === true
                          ? "Matches counter"
                          : i.complete === false
                            ? "Missing battles"
                            : "Not comparable"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {d.coverage.available
                ? "No comparable observation interval is available here. Coverage is unknown."
                : "Coverage could not be read. Battle evidence is still shown; coverage is unknown."}
            </p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2 className="panel__head m-0">
          Recorded sessions · page {pages.length}
        </h2>
        <div className="panel__body">
          <p className="page-head__note">
            Adjacent recorded battles less than 30 minutes apart are grouped
            here. Groups cover this page only and may continue on another page;
            gaps can hide play. Each mode stays named separately. Open a battle
            for its existing full detail and session.
          </p>
          {!sessions.length ? (
            <p>
              No clan battles recorded on this page.{" "}
              {d.next_cursor
                ? "There are older records to read."
                : "The bounded record is exhausted."}{" "}
              Missing capture remains unknown.
            </p>
          ) : (
            sessions.map((group, index) => (
              <div key={group[0].battle_id} className="mb-4">
                <h3 className="label">
                  Recorded group {index + 1} · {stamp(group.at(-1).battle_time)}{" "}
                  – {stamp(group[0].battle_time)}
                </h3>
                <div className="table__scroll" tabIndex={0}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Battle</th>
                        <th>Mode</th>
                        <th>Result</th>
                        <th>Crowns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((b) => (
                        <tr key={b.battle_id}>
                          <td>
                            {b.url ? (
                              <a href={b.url}>{stamp(b.battle_time)}</a>
                            ) : (
                              stamp(b.battle_time)
                            )}
                          </td>
                          <td title={b.game_mode?.name ?? undefined}>
                            {MODE_LABEL[b.mode_group] ??
                              b.game_mode?.name ??
                              b.mode_group ??
                              "Unknown"}
                          </td>
                          <td>{b.outcome ?? "Unknown"}</td>
                          <td>
                            {number(b.crowns)} – {number(b.opponent_crowns)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
      </section>
    </>
  );
}
