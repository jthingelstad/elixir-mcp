import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { agoExact, secsSince } from "../lib/time.js";

/**
 * Service ▸ Status ▸ Collectors — the whole fleet, and one machine.
 *
 * Health and share are PUBLIC: a collector is named for its Clash Royale
 * card and credited to its operator, and anyone can see whether the
 * fleet is keeping up. Endpoint mix, errors and the machine label belong
 * to the operator and only appear on their own collectors.
 *
 * The two clocks are the point of the detail screen. A heartbeat is any
 * contact with the door, including a poll that found no work; data
 * freshness is the last payload we accepted. A fresh heartbeat with
 * stale data is an IDLE collector, not a broken one, and reading one
 * clock alone cannot tell you which.
 */
function StateChip({ collector, now }) {
  const beat = secsSince(collector.last_heartbeat_at, now);
  const tone =
    collector.status !== "active"
      ? "warn"
      : beat == null || beat > 600
        ? "warn"
        : "ok";
  const label =
    collector.status !== "active"
      ? collector.status
      : beat == null || beat > 600
        ? "behind"
        : "healthy";
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__dot" />
      {label}
    </span>
  );
}

export function Fleet({ navigate }) {
  // Stamped once per load rather than read during render:
  // a clock read while rendering makes every re-render a new answer.
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState(null);
  const [mine, setMine] = useState(null);

  useEffect(() => {
    api.publicStatus().then((r) => r.ok && setStatus(r.data));
    api.myGateways().then((r) => r.ok && setMine(r.data.gateways ?? []));
  }, []);

  if (!status) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;

  const fleet = status.collectors ?? [];
  const todays = fleet.reduce((n, c) => n + (c.fetches_1h ?? 0), 0);
  const mineIds = new Set((mine ?? []).map((g) => g.card_name ?? g.name));
  const runsOne = (mine ?? []).length > 0;

  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/status/service")}>‹ Status</a>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <h1 className="page__title">Collectors</h1>
          <p className="page__lede">
            Every machine fetching for the corpus, inside one shared budget.
          </p>
        </div>
        {/* Raising a hand is the ONLY way a collector comes to exist, for
            anyone, any number of times (Jamie, 2026-09-11): it lives on
            its own page, and this is the door to it. Once you run one the
            door only changes its word. */}
        {mine !== null && (
          <button
            className="btn btn--primary"
            style={{ marginLeft: "auto" }}
            onClick={() => navigate("/status/collectors/new")}
          >
            <Icon name="plus" size={16} />
            {runsOne ? "Run another" : "Run a collector"}
          </button>
        )}
      </div>

      {mine !== null && !runsOne && (
        <div
          className="empty"
          style={{ maxWidth: "70ch", marginBottom: "18px" }}
        >
          <div className="empty__title">You don&rsquo;t run one yet</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            A collector is a machine that fetches for the corpus on a schedule.
            It earns you bonus quota — 10 fetches buys one extra daily call, up
            to 4× your base — and wears a Clash Royale card of your choosing as
            its public name.
          </p>
        </div>
      )}

      <div className="table__scroll">
        <table className="table" style={{ minWidth: "640px" }}>
          <thead>
            <tr>
              <th>NAME</th>
              <th>RUN BY</th>
              <th style={{ textAlign: "right" }}>YIELD</th>
              <th>LAST FETCH</th>
              <th style={{ textAlign: "right" }}>SHARE</th>
              <th>VERSION</th>
              <th>STATE</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((c) => (
              <tr key={c.name}>
                <td>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    {c.card_icon && (
                      <img
                        src={c.card_icon}
                        alt=""
                        style={{ height: "22px", borderRadius: "3px" }}
                      />
                    )}
                    {/* Ownership is the one thing gold marks in a table:
                        the name of the one that is yours, with a quiet word
                        beside it — never a tinted row. */}
                    <a
                      style={{
                        fontWeight: 600,
                        color: mineIds.has(c.name) ? "var(--gold)" : undefined,
                      }}
                      onClick={() =>
                        navigate(
                          `/status/collectors/${encodeURIComponent(c.name)}`,
                        )
                      }
                    >
                      {c.name}
                    </a>
                    {mineIds.has(c.name) && (
                      <span
                        style={{
                          color: "var(--ink-faint)",
                          fontSize: "11.5px",
                        }}
                      >
                        yours
                      </span>
                    )}
                  </span>
                </td>
                <td>{c.operator ?? "—"}</td>
                <td
                  style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}
                  title="share of the last day's fetches that changed the record"
                >
                  {typeof c.yield_24h === "number"
                    ? `${Math.round(c.yield_24h * 100)}%`
                    : "—"}
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)" }}
                  title="as of when this page loaded"
                >
                  {agoExact(c.last_success_at, now)}
                </td>
                <td
                  style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}
                >
                  {todays > 0
                    ? `${Math.round(((c.fetches_1h ?? 0) / todays) * 100)}%`
                    : "—"}
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)" }}
                  title="the client version it last submitted with"
                >
                  {c.version ?? "—"}
                </td>
                <td>
                  <StateChip collector={c} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className="footnote"
        style={{ margin: "12px 2px 0", maxWidth: "78ch" }}
      >
        Yield is the share of the last day&rsquo;s fetches that changed the
        record; share is of the last hour&rsquo;s fetches. Behind means the
        machine has not reported inside its schedule — which is not the same as
        broken: a collector with nothing due is idle.
      </p>
    </>
  );
}
