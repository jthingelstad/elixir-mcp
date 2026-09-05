import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Account ▸ Activity (SITE-IA): three audiences, three tabs —
 *  debugging your agent (MCP requests), auditing your account
 *  (events), and reading your pipe (notifications). The web view of
 *  notifications never advances the agents' seen-cursor. */
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

  return (
    <div className="panel">
      <h3>Activity</h3>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={t === tab ? "tab active" : "tab"}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "MCP requests" && (
        <>
          <p className="fine">
            The last 200 tool calls your agents (and this site&rsquo;s explorer)
            made on your account.
          </p>
          {requests?.length === 0 && <p>No calls yet.</p>}
          {requests?.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Tool</th>
                    <th>Via</th>
                    <th>ms</th>
                    <th>Result</th>
                    <th>Args</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <code>{r.tool}</code>
                      </td>
                      <td>{r.surface}</td>
                      <td>{r.duration_ms}</td>
                      <td>
                        {r.error_code ? (
                          <span className="error">{r.error_code}</span>
                        ) : (
                          `${((r.result_bytes ?? 0) / 1024).toFixed(1)}kb${r.truncated ? " (truncated)" : ""}`
                        )}
                      </td>
                      <td className="fine" title={r.args}>
                        {r.args && r.args !== "{}"
                          ? r.args.slice(0, 60) +
                            (r.args.length > 60 ? "…" : "")
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "Account events" && (
        <>
          <p className="fine">
            Sign-ins, adds, recordings, role changes — your account&rsquo;s own
            history.
          </p>
          {events?.length === 0 && <p>Nothing yet.</p>}
          {events?.length > 0 && (
            <table>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td>{e.kind.replaceAll("_", " ")}</td>
                    <td>
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
          )}
        </>
      )}

      {tab === "Notifications" && (
        <>
          <p className="fine">
            Your event pipe — what the notify bells feed. Reading here never
            marks anything seen for your agents; rows past your agents&rsquo;
            cursor are bolded as unread.
          </p>
          {feed?.events?.length === 0 && (
            <p>
              Nothing yet. Everything you add feeds this pipe while its bell is
              on.
            </p>
          )}
          {feed?.events?.length > 0 && (
            <table>
              <tbody>
                {feed.events.map((e) => (
                  <tr
                    key={e.event_id}
                    style={
                      Number(e.event_id) > feed.seen_through
                        ? { fontWeight: 600 }
                        : undefined
                    }
                  >
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td>{e.topic.replaceAll("_", " ")}</td>
                    <td>{e.subject_tag ? <code>{e.subject_tag}</code> : ""}</td>
                    <td className="fine">
                      {e.payload?.count ? `${e.payload.count} battles` : ""}
                      {e.payload?.scope ?? ""}
                      {e.payload?.role ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
