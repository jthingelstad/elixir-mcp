import { useEffect, useState } from "react";
import { api } from "../api.js";
import { LogTable } from "../components/LogTable.jsx";

/**
 * Activity's three views: notifications, MCP requests, account events.
 *
 * They are rail sub-pages now, and all three are the SAME table with
 * different columns — see components/LogTable.jsx. Activity lands on
 * Notifications, which is the pipe your connections read from and the
 * thing a reader opening Activity is usually asking about.
 *
 * Naming here follows the product, not the schema: mcp_call_audit is
 * "MCP requests", event_feed is "notifications" (queued for a connection
 * to pick up, never email), account_event is "account events".
 */
const BY_SUB = {
  notifications: "notifications",
  requests: "requests",
  events: "events",
};

const when = (ts) =>
  ts ? new Date(ts).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—";

export function Activity({ sub, navigate }) {
  const view = BY_SUB[sub] ?? "notifications";
  const [requests, setRequests] = useState(null);
  const [events, setEvents] = useState(null);
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    if (view === "requests" && requests === null)
      api.myRequests().then((r) => r.ok && setRequests(r.data.requests));
    if (view === "events" && events === null)
      api.activity().then((r) => r.ok && setEvents(r.data.events));
    if (view === "notifications" && feed === null)
      api.myEvents().then((r) => r.ok && setFeed(r.data));
  }, [view, requests, events, feed]);

  if (view === "requests") {
    const rows = (requests ?? []).map((r) => [
      when(r.created_at),
      r.token_name ?? r.surface ?? "",
      r.tool ?? "",
      r.error_code
        ? { text: r.error_code, tone: "bad" }
        : r.truncated
          ? { text: "ok · truncated", tone: "warn" }
          : "ok",
      // Over 300ms is worth seeing without being a failure, so it is ink
      // on the number rather than a state of the row.
      {
        text: String(r.duration_ms ?? ""),
        ink: r.duration_ms > 300 ? "var(--warn)" : undefined,
      },
      // The id opens the call record - request, response, timings -
      // the way a notification id opens its body.
      r.request_id
        ? {
            text: r.request_id.slice(0, 8),
            title: r.request_id,
            onClick: () => navigate?.(`/account/activity/c/${r.request_id}`),
          }
        : "—",
    ]);
    return (
      <LogTable
        crumb="Activity"
        title="MCP requests"
        note="Every call your connections made, newest first."
        cols={[
          ["WHEN", "left"],
          ["CONNECTION", "left"],
          ["TOOL", "left"],
          ["RESULT", "left"],
          ["MS", "right"],
          ["REQUEST", "left"],
        ]}
        rows={rows}
        monoCols={[0, 2, 5]}
        filters={[
          { key: "connection", label: "Connection", col: 1 },
          { key: "tool", label: "Tool", col: 2 },
          { key: "result", label: "Result", col: 3 },
        ]}
        empty="No calls yet. A connection appears here the first time it reads."
        footnote="mcp_call_audit — every tool call your connections and this site's explorer made, last 200. REQUEST is the id the caller was handed in meta.request_id; open it for the request, the response and where the time went."
      />
    );
  }

  if (view === "events") {
    const rows = (events ?? []).map((e) => [
      when(e.created_at),
      (e.kind ?? "").replaceAll("_", " "),
      e.detail?.player_tag ??
        e.detail?.clan_tag ??
        e.detail?.role ??
        e.detail?.name ??
        "",
    ]);
    return (
      <LogTable
        crumb="Activity"
        title="Account events"
        note="Changes to your account, your access and what we record for you."
        cols={[
          ["WHEN", "left"],
          ["EVENT", "left"],
          ["DETAIL", "left"],
        ]}
        rows={rows}
        monoCols={[0]}
        filters={[{ key: "event", label: "Event", col: 1 }]}
        empty="Nothing yet."
        footnote="account_event — sign-ins, players and clans added, recording changes and tier changes."
      />
    );
  }

  const rows = (feed?.events ?? []).map((e) => {
    const unread = Number(e.event_id) > Number(feed.seen_through ?? 0);
    return [
      {
        text: `nt_${e.event_id}`,
        onClick: () => navigate?.(`/account/activity/n/${e.event_id}`),
      },
      when(e.created_at),
      (e.topic ?? "").replaceAll("_", " "),
      e.subject_tag ?? "",
      // Unread is a state of the row, so it gets the dot; read rows are
      // plain, because "already picked up" is the ordinary case.
      unread ? { text: "waiting", tone: "accent-bright" } : "picked up",
    ];
  });
  return (
    <LogTable
      crumb="Activity"
      title="Notifications"
      note="Queued for a connection to pick up on its next call. Turned on per tracked player or clan."
      cols={[
        ["ID", "left"],
        ["WHEN", "left"],
        ["WHY", "left"],
        ["TRACKING", "left"],
        ["STATE", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1, 3]}
      filters={[
        { key: "why", label: "Why", col: 2 },
        { key: "tracking", label: "Tracking", col: 3 },
        { key: "state", label: "State", col: 4 },
      ]}
      empty="Nothing yet — everything you track feeds this queue while its notify switch is on."
      footnote="Reading this page never advances a connection's cursor: what is waiting here is waiting for the connection, not for you."
    />
  );
}

/**
 * One notification, showing the JSON BODY the connection receives.
 *
 * The console's job here is to make the wire visible: an agent builder
 * debugging "why did my bot not react to that" needs the payload it was
 * actually handed, not our prose about it. Each topic carries its own
 * shape, and the subject key is `clan` or `player` depending on what is
 * tracked — which is exactly the kind of thing a screenshot of a table
 * cannot tell you.
 */
export function NotificationRecord({ id, navigate }) {
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    api.myEvents().then((r) => r.ok && setFeed(r.data));
  }, []);

  if (!feed) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  const row = feed.events?.find((e) => String(e.event_id) === String(id));
  if (!row)
    return (
      <>
        <div className="page__crumb">
          <a onClick={() => navigate("/account/activity")}>‹ Notifications</a>
        </div>
        <div className="empty">
          <div className="empty__title">
            That notification is not in the feed
          </div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            The feed holds the last 100. Older ones expire once every connection
            that wanted them has read them.
          </p>
        </div>
      </>
    );

  const unread = Number(row.event_id) > Number(feed.seen_through ?? 0);
  // The body is what elixir_events hands a connection for this row.
  // The same keys elixir_events returns, so what the console shows IS
  // the wire, plus the name of the tool that reads it.
  const body = {
    event_id: Number(row.event_id),
    topic: row.topic,
    ...(row.subject_tag ? { subject_tag: row.subject_tag } : {}),
    created_at: row.created_at,
    ...(row.payload ? { payload: row.payload } : {}),
    read_with: "elixir_events",
  };

  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/account/activity")}>‹ Notifications</a>
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
          <h1
            className="mono"
            style={{ fontSize: "24px", margin: 0, color: "var(--ink)" }}
          >
            nt_{row.event_id}
          </h1>
          <p style={{ margin: "7px 0 0", color: "var(--ink-body)" }}>
            {(row.topic ?? "").replaceAll("_", " ")}
            {row.subject_tag ? ` · ${row.subject_tag}` : ""}
          </p>
        </div>
        <span
          className={"chip " + (unread ? "chip--info" : "chip--ok")}
          style={{ marginLeft: "auto" }}
        >
          <span className="chip__dot" />
          {unread ? "waiting" : "picked up"}
        </span>
      </div>

      <section className="panel" style={{ marginBottom: "14px" }}>
        <dl
          style={{
            margin: 0,
            padding: "14px 16px",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "11px 18px",
            fontSize: "13.5px",
          }}
        >
          <dt style={{ color: "var(--ink-faint)" }}>Created</dt>
          <dd className="mono" style={{ margin: 0, color: "var(--ink-body)" }}>
            {row.created_at}
          </dd>
          <dt style={{ color: "var(--ink-faint)" }}>Topic</dt>
          <dd className="mono" style={{ margin: 0, color: "var(--ink-body)" }}>
            {row.topic}
          </dd>
          <dt style={{ color: "var(--ink-faint)" }}>Tracking</dt>
          <dd style={{ margin: 0, color: "var(--ink)" }}>
            {row.subject_tag ?? "—"}
          </dd>
        </dl>
      </section>

      <section className="code">
        <div className="code__head">
          <span className="label">body</span>
          <span className="footnote">what the connection receives</span>
        </div>
        <pre className="code__body">{JSON.stringify(body, null, 2)}</pre>
      </section>
    </>
  );
}
