import { usePublicEfficiency } from "../lib/queries.js";

/**
 * Service ▸ Status ▸ Efficiency — what the battlelog schedule costs and
 * what it loses, per day. Jamie, 2026-09-19: "we should be displaying
 * that battle log breakage somewhere in the collector interface".
 *
 * PUBLIC, like the fleet: aggregates only, no player named. The loss is
 * the recorder's own measurement against the game's lifetime battle
 * counter (docs/recording, "How often a subject is fetched"): known the
 * morning after, so today's row says polls and gaps and leaves the loss
 * blank rather than guess.
 */
const n = (v) => (v == null ? "—" : Number(v).toLocaleString());
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");

function Row({ d, today = false }) {
  const captured = d.battles_captured ?? 0;
  const lost = d.lost_battles;
  return (
    <tr>
      <td className="mono">
        {d.day}
        {today && <span className="text-ink-faint"> so far</span>}
      </td>
      <td className="td--num">{n(d.battlelog_polls)}</td>
      <td className="td--num">{pct(d.nothing_new_polls, d.battlelog_polls)}</td>
      <td className="td--num">{n(captured)}</td>
      <td className="td--num">{n(d.gaps)}</td>
      <td className="td--num">
        {lost == null ? (
          <span className="text-ink-faint">tomorrow</span>
        ) : (
          n(lost)
        )}
      </td>
      <td className="td--num">
        {lost == null ? "—" : pct(lost, lost + captured)}
      </td>
    </tr>
  );
}

export function Efficiency({ navigate }) {
  const data = usePublicEfficiency().data ?? null;
  if (!data) return <p className="text-ink-faint">Loading…</p>;

  const days = [...(data.days ?? [])].reverse();
  const week = days.slice(0, 7);
  const sum = (k) => week.reduce((a, d) => a + (d[k] ?? 0), 0);
  const weekLost = sum("lost_battles");
  const weekCaptured = sum("battles_captured");
  const weekPolls = sum("battlelog_polls");
  const rule = data.rule ?? {};

  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/status/service")}>‹ Status</a>
      </div>
      <h1 className="page__title">Efficiency</h1>
      <p className="page__lede">
        What the battle-log schedule costs, and what it loses. Battles lost are
        measured against the game&rsquo;s own lifetime battle counter, nightly.
      </p>

      <section className="panel mb-4">
        <div className="panel__head">
          <span>The session clock</span>
          <span className="mono ml-auto font-normal">
            since {rule.since ?? "—"}
          </span>
        </div>
        <div className="panel__body">
          While a player is playing, their battle log is read every{" "}
          {rule.followup_minutes ?? 30} minutes. After a read that found nothing
          new the wait doubles, and never passes {rule.ceiling_minutes ?? 120}{" "}
          minutes. Profiles are read once a day and once after a session.
        </div>
      </section>

      <section className="panel mb-4">
        <div className="panel__head">
          <span>Last seven closed days</span>
        </div>
        <div className="stats">
          <div className="stats__cell">
            <div className="label">battle-log reads</div>
            <div className="stats__value">{n(weekPolls)}</div>
            <div className="stats__note">
              {week.length
                ? `${n(Math.round(weekPolls / week.length / 24))} an hour`
                : "—"}
            </div>
          </div>
          <div className="stats__cell">
            <div className="label">found nothing new</div>
            <div className="stats__value">
              {pct(sum("nothing_new_polls"), weekPolls)}
            </div>
            <div className="stats__note">
              of reads; an empty read costs a call and no body
            </div>
          </div>
          <div className="stats__cell">
            <div className="label">battles captured</div>
            <div className="stats__value">{n(weekCaptured)}</div>
            <div className="stats__note">new to the record</div>
          </div>
          <div className="stats__cell">
            <div className="label">battles lost</div>
            <div className="stats__value">{n(weekLost)}</div>
            <div className="stats__note">
              {pct(weekLost, weekLost + weekCaptured)} of what was played
            </div>
          </div>
        </div>
        <div className="panel__foot">
          A battle is lost when a sitting rolls past the API&rsquo;s 30-entry
          log before it is read. The count is the lifetime counter&rsquo;s move
          over each profile interval, less what the record holds inside it, with
          intervals that had no capture gap setting the floor for modes the log
          never shows.
        </div>
      </section>

      <div className="table__scroll" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th>DAY (UTC)</th>
              <th className="td--num">READS</th>
              <th className="td--num">NOTHING NEW</th>
              <th className="td--num">CAPTURED</th>
              <th className="td--num">GAPS</th>
              <th className="td--num">LOST</th>
              <th className="td--num">LOST %</th>
            </tr>
          </thead>
          <tbody>
            {data.today && <Row d={data.today} today />}
            {days.map((d) => (
              <Row key={d.day} d={d} />
            ))}
          </tbody>
        </table>
      </div>
      {days.length === 0 && (
        <p className="footnote">
          The first closed day lands the morning after this page shipped.
        </p>
      )}
      <p className="footnote">
        Last hour: {n(data.last_hour?.battlelog_polls)} reads,{" "}
        {pct(
          data.last_hour?.nothing_new_polls ?? 0,
          data.last_hour?.battlelog_polls ?? 0,
        )}{" "}
        found nothing, {n(data.last_hour?.gaps)} gaps. Also in{" "}
        <code>/api/public/efficiency</code>.
      </p>
    </>
  );
}
