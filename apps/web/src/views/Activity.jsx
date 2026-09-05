import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Account ▸ Activity (design handoff §8): three segmented tabs, one
 *  table whose columns change per tab; each tab names its source in
 *  the footnote. Latency over 300ms renders amber. The notifications
 *  view never advances the agents' seen-cursor. */
const TABS = ["MCP requests", "Account events", "Notifications"];

export function Activity() {
  const [tab, setTab] = useState(TABS[0]);
  const [requests, setRequests] = useState(null);
  const [events, setEvents] = useState(null);
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    if (tab === "MCP requests" && requests === null)
      api.myRequests().then((r) => r.ok && setRequests(r.data.requests));
    if (tab === "Account events" && events === null)
      api.activity().then((r) => r.ok && setEvents(r.data.events));
    if (tab === "Notifications" && feed === null)
      api.myEvents().then((r) => r.ok && setFeed(r.data));
  }, [tab, requests, events, feed]);

  const when = (ts) =>
    new Date(ts).toISOString().slice(5, 16).replace("T", " ") + "Z";

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Activity</h1>
        <span className="page-head__note">
          what your agents did, what your account did, what your pipe holds
        </span>
      </div>
      <div
        className="segmented"
        role="tablist"
        style={{ marginBottom: "16px" }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab ? "true" : "false"}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <section className="panel">
        {tab === "MCP requests" && (
          <>
            {requests?.length === 0 && (
              <div className="panel__body" style={{ color: "var(--faint)" }}>
                No calls yet.
              </div>
            )}
            {requests?.length > 0 && (
              <div className="tablewrap">
                <table style={{ minWidth: "640px" }}>
                  <thead>
                    <tr>
                      <th>WHEN</th>
                      <th>TOOL</th>
                      <th>AGENT</th>
                      <th className="num">MS</th>
                      <th>RESULT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{when(r.created_at)}</td>
                        <td>
                          <code>{r.tool}</code>
                        </td>
                        <td>{r.surface}</td>
                        <td
                          className="num"
                          style={
                            r.duration_ms > 300
                              ? { color: "var(--amber)" }
                              : undefined
                          }
                        >
                          {r.duration_ms}
                        </td>
                        <td>
                          {r.error_code ? (
                            <span className="outcome outcome--loss">
                              {r.error_code}
                            </span>
                          ) : (
                            <span
                              className="mono"
                              style={{ color: "var(--dim)" }}
                            >
                              {((r.result_bytes ?? 0) / 1024).toFixed(1)}kb
                              {r.truncated ? " · truncated" : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="panel__note">
              <code>mcp_call_audit</code> · every tool call your agents (and
              this site&rsquo;s explorer) made, newest first, last 200.
            </div>
          </>
        )}

        {tab === "Account events" && (
          <>
            {events?.length === 0 && (
              <div className="panel__body" style={{ color: "var(--faint)" }}>
                Nothing yet.
              </div>
            )}
            {events?.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>WHEN</th>
                      <th>EVENT</th>
                      <th>SUBJECT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{when(e.created_at)}</td>
                        <td>{e.kind.replaceAll("_", " ")}</td>
                        <td className="tag">
                          {e.detail?.player_tag ??
                            e.detail?.clan_tag ??
                            e.detail?.role ??
                            e.detail?.name ??
                            ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="panel__note">
              account events · sign-ins, adds, recordings, role changes.
            </div>
          </>
        )}

        {tab === "Notifications" && (
          <>
            {feed?.events?.length === 0 && (
              <div className="panel__body" style={{ color: "var(--faint)" }}>
                Nothing yet — everything you add feeds this pipe while its
                notify switch is on.
              </div>
            )}
            {feed?.events?.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>WHEN</th>
                      <th>KIND</th>
                      <th>SUBJECT</th>
                      <th>DETAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.events.map((e) => {
                      const unread = Number(e.event_id) > feed.seen_through;
                      return (
                        <tr
                          key={e.event_id}
                          style={unread ? { fontWeight: 600 } : undefined}
                        >
                          <td className="mono">{when(e.created_at)}</td>
                          <td>{e.topic.replaceAll("_", " ")}</td>
                          <td className="tag">{e.subject_tag ?? ""}</td>
                          <td className="mono" style={{ color: "var(--dim)" }}>
                            {e.payload?.count
                              ? `${e.payload.count} battles`
                              : (e.payload?.scope ?? e.payload?.role ?? "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="panel__note">
              <code>event_feed</code> · reading here never marks anything seen
              for your agents — bold rows are past their cursor.
            </div>
          </>
        )}
      </section>
    </>
  );
}
