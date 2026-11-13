import { Icon, Link, LogTable, Row, useClock } from "@elixir-mcp/ui";
import {
  useActivityEvents,
  useMyEmailSends,
  useMyRequests,
} from "../../lib/queries.js";
import { useScopedPath } from "../../lib/scope.js";
import { SETTINGS } from "../../lib/settings.js";
import { eventDetail, eventLabel } from "./events.js";
import { Crumb } from "./parts.jsx";

/** Usage's busiest-tools links land already filtered. Read once, at open;
 *  after that the filter is state, so clearing it works like any other. */
function initialToolFilter(search) {
  const tool = new URLSearchParams(search).get("tool");
  return tool ? { tool } : null;
}

/** The server's refusal, in words. The list carries the tool's error code;
 *  a code nobody named reads as itself. */
const REFUSED = {
  quota_exceeded: "daily budget",
  rate_limited: "rate limit",
  not_available: "not available to this connection",
  unknown_tool: "unknown tool",
  missing_capability: "missing permission",
};
function outcome(r) {
  if (r.error_code)
    return {
      group: "Refused",
      text: `Refused: ${REFUSED[r.error_code] ?? r.error_code.replaceAll("_", " ")}`,
    };
  return { group: "OK", text: r.truncated ? "OK, truncated" : "OK" };
}

/** Every call this account's connections made. Filters are built from the
 *  rows, so one offers what the log actually holds. */
export function Requests({
  search = typeof window === "undefined" ? "" : window.location.search,
}) {
  const { when } = useClock();
  const path = useScopedPath();
  const query = useMyRequests(true);
  const rows = (query.data?.requests ?? []).map((r) => {
    const out = outcome(r);
    return [
      r.token_name ?? r.surface ?? "",
      r.tool ?? "",
      out.group,
      {
        text: r.tool ?? "",
        href: r.request_id
          ? path(`${SETTINGS}/usage/requests/${r.request_id}`)
          : undefined,
        title: `${r.token_name ?? r.surface ?? ""} · ${when(r.created_at)} · ${r.duration_ms ?? "?"} ms`,
      },
      out.text,
    ];
  });
  return (
    <LogTable
      crumb={<Link to={path(`${SETTINGS}/usage`)}>‹ Usage and limits</Link>}
      title="Requests"
      note="Every call your connections made, newest first."
      loading={query.isPending}
      error={
        query.isError
          ? "Your requests could not be read just now. Try again shortly."
          : null
      }
      cols={[
        ["Connection", "left"],
        ["Tool", "left"],
        ["Result", "left"],
      ]}
      rows={rows}
      initialFilters={initialToolFilter(search)}
      filters={[
        {
          key: "connection",
          label: "Connection",
          any: "Every connection",
          col: 0,
        },
        { key: "tool", label: "Tool", any: "Every tool", col: 1 },
        { key: "result", label: "Result", any: "Every result", col: 2 },
      ]}
      renderRow={(row) => (
        <Row
          title={<span className="mono">{row[1]}</span>}
          detail={row[3].title}
          right={<span className="hint">{row[4]}</span>}
          href={row[3].href}
        />
      )}
      empty={
        <>
          No calls yet. A connection appears here the first time it reads.{" "}
          <Link to={`${SETTINGS}/connections`}>Connect an AI</Link>
        </>
      }
      footnote="The last 200 tool calls by your connections and by this site. Each request id is the one the caller was handed, in meta.request_id. Open a call for the request, the response and where the time went. A call, its request and its response are kept 28 days."
    />
  );
}

/** Every product email sent to this account. The record is where "report a
 *  problem with this email" lives. */
export function Sent() {
  const { when } = useClock();
  const query = useMyEmailSends(true);
  const rows = (query.data?.sends ?? []).map((m) => [
    m.label ?? m.kind,
    m.subject ?? m.label ?? m.kind,
    `${m.label ?? m.kind} · ${when(m.sent_at)} · Mail ${m.send_id.slice(0, 8)}`,
    `${SETTINGS}/emails/${m.send_id}`,
  ]);
  return (
    <LogTable
      crumb={<Link to={`${SETTINGS}/emails`}>‹ Emails</Link>}
      title="Sent to you"
      note="Every email Elixir sent you, newest first. Open one to see it as it was sent, or to report a problem with it."
      loading={query.isPending}
      error={
        query.isError
          ? "Your sent emails could not be read just now. Try again in a moment."
          : null
      }
      cols={[
        ["Kind", "left"],
        ["Subject", "left"],
      ]}
      rows={rows}
      filters={[{ key: "kind", label: "Kind", any: "Every kind", col: 0 }]}
      renderRow={(row) => (
        <Row
          title={row[1]}
          detail={row[2]}
          right={<Icon name="chevron-right" size={15} />}
          href={row[3]}
        />
      )}
      empty={
        <>
          Nothing sent yet. Emails says which mail you get. Each one arrives
          here as it is sent. <Link to={`${SETTINGS}/emails`}>Emails</Link>
        </>
      }
      footnote="The last 200. The id is the one printed in the mail's footer. Sign-in codes are not listed."
    />
  );
}

/** Changes to an agent's own account, one of its logs under Usage. */
export function AgentEvents({ agent }) {
  const { when } = useClock();
  const query = useActivityEvents(true);
  const rows = (query.data?.events ?? []).map((e) => [
    eventLabel(e.kind),
    eventDetail(e),
    when(e.created_at),
  ]);
  return (
    <>
      <Crumb to={`${SETTINGS}/agents/${agent}/usage`}>Usage</Crumb>
      <LogTable
        title="Account events"
        note="Changes to this agent's account, its access and what it records."
        loading={query.isPending}
        error={
          query.isError
            ? "This agent's account events could not be read just now. Try again in a moment."
            : null
        }
        cols={[
          ["Event", "left"],
          ["Detail", "left"],
          ["When", "left"],
        ]}
        rows={rows}
        filters={[{ key: "event", label: "Event", any: "Every event", col: 0 }]}
        renderRow={(row) => (
          <Row
            title={row[0]}
            detail={row[1] || null}
            right={<span className="hint">{row[2]}</span>}
          />
        )}
        empty="Nothing yet."
      />
    </>
  );
}
