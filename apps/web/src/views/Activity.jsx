import { LogTable, useClock } from "@elixir-mcp/ui";
import {
  useActivityEvents,
  useMyEmailSends,
  useMyRequests,
} from "../lib/queries.js";
import { useConsolePath, useScope } from "../lib/scope.js";

/**
 * Activity's three views: MCP requests, emails, account events.
 *
 * They are rail sub-pages, and all three are the SAME table with
 * different columns — see components/LogTable.jsx. Activity lands on MCP
 * requests. The timeline was its first view until 2026-09-23, when it
 * became a rail item of its own (views/account/Timeline.jsx).
 *
 * Naming here follows the product, not the schema: mcp_call_audit is
 * "MCP requests", email_send is "Emails", account_event is "account
 * events".
 */
const BY_SUB = {
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

export function Activity({ sub, navigate }) {
  const { stamp } = useClock();
  const path = useConsolePath();
  // An agent's console has no Emails: an agent has no address, and the
  // person's mail is never shown under an agent's header.
  const scoped = Boolean(useScope());
  const view =
    scoped && sub === "emails" ? "requests" : (BY_SUB[sub] ?? "requests");
  // Each tab loads only its own read, and a tab already read is served
  // from the cache when you come back to it.
  const requestsQuery = useMyRequests(view === "requests");
  const requests = requestsQuery.data?.requests ?? null;
  const sends = useMyEmailSends(view === "emails").data?.sends ?? null;
  const events = useActivityEvents(view === "events").data?.events ?? null;

  if (view === "requests") {
    const rows = (requests ?? []).map((r) => [
      stamp(r.created_at),
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
            onClick: () =>
              navigate?.(path(`/account/activity/c/${r.request_id}`)),
          }
        : "—",
    ]);
    return (
      <LogTable
        loading={requestsQuery.isPending}
        error={
          requestsQuery.isError
            ? "Your requests could not be read just now; try again shortly."
            : null
        }
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
      stamp(m.sent_at),
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

  const rows = (events ?? []).map((e) => {
    const tag = e.detail?.player_tag ?? e.detail?.clan_tag ?? null;
    return [
      stamp(e.created_at),
      (e.kind ?? "").replaceAll("_", " "),
      tag
        ? e.detail?.subject_name
          ? `${e.detail.subject_name} ${tag}`
          : tag
        : (e.detail?.role ?? e.detail?.name ?? ""),
    ];
  });
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
