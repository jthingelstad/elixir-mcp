import { Icon, Link, useClock, noun, Empty, ErrorState } from "@elixir-mcp/ui";
import { useState } from "react";
import { useCallRecord } from "../../lib/queries.js";
import { useScopedPath } from "../../lib/scope.js";
import { SETTINGS } from "../../lib/settings.js";

/**
 * One tool call: the request as sent, the response as received, and
 * where the time went.
 *
 * The app's job here is the same as the notification record's: make
 * the wire visible. An agent builder asking "what did my bot actually
 * send to war_history, and what came back" reads it here rather than
 * from our prose; a reader of the Activity log opens a row to see why it
 * took four seconds. The bodies come from the archive through the same
 * session check as the row, one call at a time.
 *
 * Rendering rules: the response's `meta` envelope is folded (it is the
 * same twelve fields on every call), and any array longer than twenty
 * rows is cut with a "show all" control, because a 400-battle answer is
 * evidence to scroll past, not to read.
 */
const FOLD_ARRAYS_OVER = 20;

const ms = (v) => (v == null ? "—" : `${Number(v).toLocaleString()} ms`);
const bytes = (v) =>
  v == null
    ? "—"
    : v >= 1024
      ? `${(v / 1024).toFixed(1)} KB`
      : `${Number(v).toLocaleString()} B`;

/**
 * JSON, rendered as text inside a <pre> with two kinds of fold. Each
 * fold is keyed by its path so opening one leaves the others alone.
 */
function JsonTree({ value, folded, open, onOpen }) {
  const render = (v, path, indent) => {
    const pad = "  ".repeat(indent);
    const inner = "  ".repeat(indent + 1);
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const cut = v.length > FOLD_ARRAYS_OVER && !open.has(path);
      const shown = cut ? v.slice(0, FOLD_ARRAYS_OVER) : v;
      const out = ["[\n"];
      shown.forEach((item, i) => {
        out.push(inner, render(item, `${path}[${i}]`, indent + 1));
        out.push(i < shown.length - 1 || cut ? ",\n" : "\n");
      });
      if (cut)
        out.push(
          inner,
          <button
            key={`${path}:more`}
            type="button"
            className="btn btn--sm"
            onClick={() => onOpen(path)}
          >
            show all {v.length.toLocaleString()}
          </button>,
          "\n",
        );
      out.push(pad, "]");
      return out;
    }
    const entries = Object.entries(v);
    if (entries.length === 0) return "{}";
    const out = ["{\n"];
    entries.forEach(([k, item], i) => {
      const childPath = path ? `${path}.${k}` : k;
      out.push(inner, JSON.stringify(k), ": ");
      if (folded.has(childPath) && !open.has(childPath)) {
        out.push(
          <button
            key={`${childPath}:fold`}
            type="button"
            className="btn btn--sm"
            onClick={() => onOpen(childPath)}
          >
            {Array.isArray(item)
              ? `[…] ${item.length} ${noun(item.length, "item")}`
              : `{…} ${Object.keys(item ?? {}).length} ${noun(Object.keys(item ?? {}).length, "field")}`}
          </button>,
        );
      } else {
        out.push(render(item, childPath, indent + 1));
      }
      out.push(i < entries.length - 1 ? ",\n" : "\n");
    });
    out.push(pad, "}");
    return out;
  };
  // Keys for React: every node gets an index-stable position in the
  // flattened array, which is enough for a tree that only ever grows.
  const nodes = [render(value, "", 0)].flat(Infinity);
  return (
    <pre className="code__body">
      {nodes.map((n, i) =>
        typeof n === "string" ? <span key={i}>{n}</span> : n,
      )}
    </pre>
  );
}

function JsonSection({ label, note, value, folded = [] }) {
  const [open, setOpen] = useState(() => new Set());
  const onOpen = (path) => setOpen((s) => new Set(s).add(path));
  return (
    <section className="code" style={{ marginBottom: "14px" }}>
      <div className="code__head">
        <span className="label">{label}</span>
        {note && <span className="footnote">{note}</span>}
      </div>
      {value === null || value === undefined ? (
        <p
          className="footnote"
          style={{ margin: 0, padding: "14px 16px", color: "var(--ink-faint)" }}
        >
          Not captured for this call.
        </p>
      ) : (
        <JsonTree
          value={value}
          folded={new Set(folded)}
          open={open}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

function Cell({ label, value, note, tone }) {
  return (
    <div className="stats__cell">
      <div className="stat__label">{label}</div>
      <div
        className="stats__value"
        style={{
          fontSize: "18px",
          color: tone ? `var(--${tone})` : undefined,
        }}
      >
        {value}
      </div>
      {note && <div className="stats__note">{note}</div>}
    </div>
  );
}

const WHOSE = { person: "a person", agent: "an agent" };

/** What kind of outcome this row records, in the page's tones. */
function outcomeOf(call) {
  if (call.rpc_error_code != null) {
    const name =
      {
        "-32029": "daily budget",
        "-32601": "not available to this connection",
        "-32602": "unknown tool",
        "-32003": "missing permission",
      }[String(call.rpc_error_code)] ?? "";
    return { text: name ? `Refused: ${name}` : "Refused", tone: "bad" };
  }
  if (call.error_code) return { text: call.error_code, tone: "bad" };
  if (call.truncated) return { text: "OK, truncated", tone: "warn" };
  return { text: "OK", tone: "ok" };
}

export function CallRecord({ id, navigate }) {
  // The record's own links stay in the scope it was opened from.
  const path = useScopedPath();
  const { when } = useClock();
  // The envelope, because 403 and 404 are answers this page reads.
  const record = useCallRecord(id);
  const status = record.data?.status ?? (record.isError ? 0 : null);
  const rec = record.data?.ok ? record.data.data : null;

  const back = (
    <div className="page__crumb">
      <Link to={path(`${SETTINGS}/usage/requests`)}>‹ Requests</Link>
    </div>
  );

  if (status === null && rec === null)
    return <p className="text-ink-faint">Loading…</p>;
  // A failed read is not an absence (console audit M1): only 403 and 404
  // say the call is not in your log.
  if (!rec && status !== 403 && status !== 404)
    return (
      <>
        {back}
        <ErrorState
          title="This call could not be read just now"
          onRetry={() => record.refetch()}
          busy={record.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </>
    );
  if (!rec?.call)
    return (
      <>
        {back}
        <Empty title="That call is not in your log">
          The log holds calls made by your own connections and by the agents you
          own. A call, its request and its response are kept 28 days. An id from
          somewhere else opens nothing here.
        </Empty>
      </>
    );

  const { call } = rec;
  const outcome = outcomeOf(call);
  const quota = rec.response?.meta?.quota ?? null;
  const connection =
    call.token_name ??
    call.client_name ??
    (call.surface === "web" ? "Elixir website" : call.surface);

  return (
    <>
      {back}
      <div className="record__head">
        <h1
          className="mono"
          style={{ fontSize: "24px", margin: 0, color: "var(--ink)" }}
        >
          {call.tool}
        </h1>
        <span className={"chip chip--" + outcome.tone}>
          <span className="chip__dot" />
          {outcome.text}
        </span>
      </div>
      <p className="record__sub">
        <span className="mono">{when(call.created_at)}</span> · {connection}
        {call.principal_kind
          ? ` · ${WHOSE[call.principal_kind] ?? call.principal_kind}`
          : ""}
        {call.on_behalf_of ? ` · on behalf of ${call.on_behalf_of}` : ""}
      </p>

      <div className="stats" style={{ marginBottom: "14px" }}>
        <Cell
          label="Duration"
          value={ms(call.duration_ms)}
          note="end to end"
          tone={call.duration_ms > 300 ? "warn" : undefined}
        />
        <Cell
          label="Database"
          value={ms(call.db_ms)}
          note={
            call.db_queries == null
              ? "not measured"
              : `${call.db_queries} ${call.db_queries === 1 ? "query" : "queries"}`
          }
        />
        <Cell
          label="Live wait"
          value={call.live_wait_ms == null ? "—" : ms(call.live_wait_ms)}
          note={call.live_wait_ms == null ? "no live fetch" : "on a collector"}
        />
        <Cell
          label="Preparing the answer"
          value={ms(call.serialize_ms)}
          note="the body's own cost"
        />
        <Cell
          label="Result"
          value={bytes(call.result_bytes)}
          note={call.truncated ? "truncated on the wire" : "as sent"}
          tone={call.truncated ? "warn" : undefined}
        />
        <Cell
          label="Starting up"
          value={call.cold_start == null ? "—" : call.cold_start ? "yes" : "no"}
          note="the first call after a quiet spell"
        />
        <Cell
          label="Error"
          value={
            call.rpc_error_code != null
              ? String(call.rpc_error_code)
              : (call.error_code ?? "none")
          }
          note={call.rpc_error_code != null ? "JSON-RPC layer" : "tool"}
          tone={
            call.error_code || call.rpc_error_code != null ? "bad" : undefined
          }
        />
        <Cell
          label="Budget after"
          value={
            quota
              ? quota.max != null
                ? `${Math.max(0, quota.max - (quota.count ?? quota.used ?? 0)).toLocaleString()} left`
                : "No ceiling"
              : "—"
          }
          note={quota ? "calls today" : "not in this answer"}
        />
        <Cell label="Client" value={call.client_name ?? "—"} />
        <Cell label="Country" value={call.viewer_country ?? "—"} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <button
          className="btn btn--sm"
          disabled={!rec.prev}
          title={
            rec.prev ? `${rec.prev.tool} · ${when(rec.prev.created_at)}` : ""
          }
          onClick={() =>
            rec.prev &&
            navigate(path(`${SETTINGS}/usage/requests/${rec.prev.request_id}`))
          }
        >
          ‹ Previous call
        </button>
        <button
          className="btn btn--sm"
          disabled={!rec.next}
          title={
            rec.next ? `${rec.next.tool} · ${when(rec.next.created_at)}` : ""
          }
          onClick={() =>
            rec.next &&
            navigate(path(`${SETTINGS}/usage/requests/${rec.next.request_id}`))
          }
        >
          Next call ›
        </button>
        <span className="footnote" style={{ marginLeft: "4px" }}>
          by the same connection
        </span>
        {/* The call is a FIELD on the report now, not a line pasted
            into the message: it is stored as feedback.request_id, so
            the queue can link straight back to this record. */}
        <Link
          className="btn btn--sm ml-auto"
          to={`${SETTINGS}/feedback?request_id=${encodeURIComponent(call.request_id)}`}
        >
          <Icon name="message-square" size={15} />
          Report this call
        </Link>
      </div>

      <JsonSection
        label="request"
        note="The arguments as sent. Secrets are never recorded."
        value={
          rec.request ??
          (call.args ? { tool: call.tool, arguments: call.args } : null)
        }
      />
      <JsonSection
        label="response"
        note={
          call.truncated
            ? "the whole body, before the wire cut it"
            : "what the connection received"
        }
        value={rec.response}
        folded={["meta"]}
      />

      <p className="footnote" style={{ margin: "0 2px", maxWidth: "78ch" }}>
        <span className="mono">{call.request_id}</span>.{" "}
        {call.captured
          ? rec.capture_error
            ? "The request and response were kept, but could not be read back just now."
            : `Kept ${when(rec.captured_at)}. A call, its request and its response are kept 28 days.`
          : call.rpc_error_code != null
            ? "Refused before any tool ran, so there is no body to show. The arguments above are the bounded copy from the log."
            : "The request and response were not kept for this call (keeping them was off, the write failed, or it is older than 28 days). The arguments above are the bounded copy from the log."}
      </p>
    </>
  );
}
