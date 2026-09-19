import { LogTable } from "@elixir-mcp/ui";
import {
  useActivityEvents,
  useMyEmailSends,
  useMyTimeline,
  useMyRequests,
} from "../lib/queries.js";

/**
 * Activity's four views: the timeline, MCP requests, emails, account
 * events.
 *
 * They are rail sub-pages, and all four are the SAME table with
 * different columns — see components/LogTable.jsx. Activity lands on the
 * Timeline, which is what your connections read (elixir_timeline) and the
 * thing a reader opening Activity is usually asking about: what happened.
 *
 * Naming here follows the product, not the schema: mcp_call_audit is
 * "MCP requests", email_send is "Emails", account_event is "account
 * events".
 */
const BY_SUB = {
  timeline: "timeline",
  requests: "requests",
  emails: "emails",
  events: "events",
};

/** Usage's busiest-tools links land here already filtered: the panel
 *  says a tool ran 400 times, and the only next question is WHICH calls.
 *  The query string is read once, at open — the filter is state after
 *  that, so clearing it works like any other. */
function initialToolFilter() {
  const tool = new URLSearchParams(window.location.search).get("tool");
  return tool ? { tool } : null;
}

const when = (ts) =>
  ts ? new Date(ts).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—";

export function Activity({ sub, navigate }) {
  const view = BY_SUB[sub] ?? "timeline";
  // Each tab loads only its own read, and a tab already read is served
  // from the cache when you come back to it.
  const requests = useMyRequests(view === "requests").data?.requests ?? null;
  const sends = useMyEmailSends(view === "emails").data?.sends ?? null;
  const events = useActivityEvents(view === "events").data?.events ?? null;
  const timeline = useMyTimeline(view === "timeline").data ?? null;

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
        initialFilters={initialToolFilter()}
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

  if (view === "emails") {
    // Every product email sent to this account, the way MCP requests
    // lists every call: the id opens the record (the mail as sent),
    // and the record is where "report a problem with this email" lives.
    const rows = (sends ?? []).map((m) => [
      when(m.sent_at),
      m.label ?? m.kind,
      {
        text: m.subject ?? "—",
        title: m.subject ?? "",
        onClick: () => navigate?.(`/account/activity/e/${m.send_id}`),
      },
      m.archived ? "kept" : { text: "not kept", tone: "warn" },
      {
        text: m.send_id.slice(0, 8),
        title: m.send_id,
        onClick: () => navigate?.(`/account/activity/e/${m.send_id}`),
      },
    ]);
    return (
      <LogTable
        crumb="Activity"
        title="Emails"
        note="Every email Elixir sent you, newest first. Open one to see it as it was sent, or to report a problem with it."
        cols={[
          ["WHEN", "left"],
          ["KIND", "left"],
          ["SUBJECT", "left"],
          ["BODY", "left"],
          ["EMAIL", "left"],
        ]}
        rows={rows}
        monoCols={[0, 4]}
        filters={[{ key: "kind", label: "Kind", col: 1 }]}
        empty="Nothing sent yet. The switches on your Profile say which emails you get; each arrives here as it is sent."
        footnote="email_send — every product email queued for your address, last 200. EMAIL is the id printed in the mail's footer; open it for the mail as it was sent and to report a problem with it. Sign-in codes are not listed."
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

  const rows = (timeline?.timeline ?? []).map((it) => {
    // Unread is a state of the row: past the account's read pointer, or
    // everything when no connection has ever marked it.
    const unread =
      !timeline?.read_to || String(it.at) > String(timeline.read_to);
    return [
      when(it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      it.text,
      unread ? { text: "unread", tone: "accent-bright" } : "read",
    ];
  });
  return (
    <LogTable
      crumb="Activity"
      title="Timeline"
      note="What happened to the players and clans you track, last seven days, oldest first. The same items a connection reads with elixir_timeline."
      cols={[
        ["WHEN", "left"],
        ["WHO", "left"],
        ["WHAT", "left"],
        ["STATE", "left"],
      ]}
      rows={rows}
      monoCols={[0]}
      filters={[
        { key: "who", label: "Who", col: 1 },
        { key: "state", label: "State", col: 3 },
      ]}
      empty="Nothing in the last seven days — everything you track appears here while its notify switch is on."
      footnote="Reading this page never moves a connection's read pointer: unread here means unread by your connections, not by you."
    />
  );
}
