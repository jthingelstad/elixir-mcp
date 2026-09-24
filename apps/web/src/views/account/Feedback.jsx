import { Icon, LogTable, Markdown, ago, useClock } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { keys, useInvalidate, useMyFeedback } from "../../lib/queries.js";
import { useConsolePath, useScope } from "../../lib/scope.js";

/**
 * Feedback — what you have told us, and what we did about it.
 *
 * The list is the console's one log table, like Notifications: an id
 * that opens the record, when, the category, the first line of what
 * was said, its state, and whether the maintainer has replied. The
 * record shows the note and the reply in full, rendered as the
 * Markdown they were written in — a note with paragraphs and a list
 * used to arrive as one run of text.
 */

/** One tone per status, read by the list and the record so the two can
 *  never disagree: new is unread (accent), planned is a promise still
 *  open (warn), done is kept (ok); seen and declined carry no tone. */
const TONE = { new: "accent-bright", planned: "warn", done: "ok" };
function statusChip(status) {
  return (
    { new: "chip--info", planned: "chip--warn", done: "chip--ok" }[status] ?? ""
  );
}

/** The first line of a note, shortened for a table cell. */
function firstLine(text, max = 72) {
  const line =
    String(text ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const CATEGORIES = ["general", "bug", "data_quality", "feature", "praise"];

function Shipped({ version }) {
  if (!version) return null;
  return (
    <a
      className="mono"
      style={{
        fontSize: "11.5px",
        color: "var(--ink-body)",
        border: "1px solid var(--line-strong)",
        borderRadius: "6px",
        padding: "1px 7px",
      }}
      // /updates is a page of the static site, not an app route: a real
      // link, or the app's router sent it home (console audit M3).
      href="/updates"
      title="The contract version this shipped in"
    >
      shipped {version}
    </a>
  );
}

export function FeedbackItem({ id, navigate }) {
  const { day } = useClock();
  const path = useConsolePath();
  const { data, isSuccess, isError } = useMyFeedback();
  const item =
    (data?.feedback ?? []).find((f) => String(f.feedback_id) === String(id)) ??
    null;
  const missed = (isSuccess || isError) && !item;
  if (missed)
    return (
      <div className="empty">
        <div className="empty__title">No feedback item #{id}</div>
        <p className="empty__body" style={{ marginBottom: 0 }}>
          Nothing by that number on your account.{" "}
          <a onClick={() => navigate(path("/account/feedback"))}>
            All feedback ›
          </a>
        </p>
      </div>
    );
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  return (
    <>
      <p className="page__crumb" style={{ marginBottom: "14px" }}>
        <a onClick={() => navigate(path("/account/feedback"))}>‹ Feedback</a>
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        {/* The id is the title: a filed note has no name of its own, and
            the number is what a maintainer's reply and the event feed
            call it. */}
        <h1
          className="mono"
          style={{
            fontWeight: 500,
            fontSize: "20px",
            margin: 0,
            color: "var(--ink)",
          }}
        >
          fb_{item.feedback_id}
        </h1>
        <span className={`chip ${statusChip(item.status)}`}>{item.status}</span>
        <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
          {item.category?.replaceAll("_", " ")} · {day(item.created_at)}
          {item.surface && item.surface !== "web"
            ? ` · via ${item.surface}`
            : ""}
        </span>
        <Shipped version={item.shipped_in} navigate={navigate} />
      </div>

      <Markdown
        text={item.message}
        style={{
          fontSize: "16px",
          color: "var(--ink)",
          margin: "0 0 22px",
          maxWidth: "70ch",
        }}
      />

      {item.request_id && (
        <p style={{ margin: "-12px 0 22px", fontSize: "13px" }}>
          About one call ·{" "}
          <a
            className="mono"
            onClick={() =>
              navigate(path(`/account/activity/c/${item.request_id}`))
            }
          >
            {item.request_id.slice(0, 8)}
          </a>
        </p>
      )}
      {item.send_id && (
        <p className="text-[13px] -mt-3 mb-[22px]">
          About one email ·{" "}
          <a
            className="mono"
            onClick={() => navigate(`/account/activity/e/${item.send_id}`)}
          >
            {item.send_id.slice(0, 8)}
          </a>
        </p>
      )}

      {item.response ? (
        <section
          style={{
            borderLeft: "2px solid var(--accent-bright)",
            padding: "2px 0 2px 16px",
            maxWidth: "70ch",
          }}
        >
          <div className="label" style={{ marginBottom: "8px" }}>
            Maintainer
            {item.responded_at ? ` · ${day(item.responded_at)}` : ""}
          </div>
          <Markdown text={item.response} />
        </section>
      ) : (
        <p style={{ fontSize: "13.5px", color: "var(--ink-faint)", margin: 0 }}>
          No reply yet. You cannot edit a filed note — send another if something
          changed.
        </p>
      )}
    </>
  );
}

/** What the URL asks the form to open with. The call record links here
 *  with ?request_id=<uuid>, which is a FIELD on the report rather than a
 *  line in the message — it used to arrive as ?context=request_id:<id>
 *  and be pasted into the textarea, where nothing could read it back.
 *  ?context= is still honoured: links to it exist. Read once. */
function prefillFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const context = q.get("context");
  return {
    context: context ? String(context).slice(0, 200) : "",
    requestId: q.get("request_id") ? String(q.get("request_id")) : "",
    // The email record links here the same way (?send_id=<uuid>).
    sendId: q.get("send_id") ? String(q.get("send_id")) : "",
  };
}

function Compose({
  onSent,
  onClose,
  context = "",
  requestId = "",
  sendId = "",
}) {
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState(context ? `${context}\n\n` : "");
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState("");
  return (
    <section className="panel" style={{ marginBottom: "18px" }}>
      <div className="panel__head">
        <span className="panel-title">Send feedback</span>
        <button
          type="button"
          className="btn btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div
        className="panel__body"
        style={{ display: "flex", flexDirection: "column", gap: "10px" }}
      >
        {sent ? (
          <div className="notice">Received — thank you. It is in the list.</div>
        ) : (
          <>
            <select
              className="select"
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            {requestId && (
              <div className="notice">
                <span>
                  Reporting one call —{" "}
                  <span className="mono">{requestId.slice(0, 8)}</span>. Its
                  request, its answer and where the time went ride along with
                  this; you do not have to describe them.
                </span>
              </div>
            )}
            {sendId && (
              <div className="notice">
                <span>
                  Reporting one email —{" "}
                  <span className="mono">{sendId.slice(0, 8)}</span>. The mail
                  as it was sent rides along with this; say what was wrong or
                  missing in it.
                </span>
              </div>
            )}
            <textarea
              rows={6}
              aria-label="Message"
              placeholder="Wrong-looking data, a missing capability, praise… Markdown is fine."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {failed && <p className="field-error">{failed}</p>}
            <div>
              <button
                className="btn btn--primary"
                disabled={!message.trim()}
                onClick={async () => {
                  const r = await api.sendFeedback(
                    message,
                    category,
                    context || undefined,
                    requestId || undefined,
                    sendId || undefined,
                  );
                  if (r.ok) {
                    setSent(true);
                    onSent();
                  } else setFailed(r.data?.message ?? "Could not send that.");
                }}
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function Feedback({ navigate }) {
  const { day, stamp } = useClock();
  const path = useConsolePath();
  // An agent's console lists what the AGENT filed (it files with
  // elixir_send_feedback). New feedback is always filed as you, from your
  // own console, so this page has no compose (2026-09-23).
  const scoped = Boolean(useScope());
  const feedbackQuery = useMyFeedback();
  const feedback = feedbackQuery.data;
  const items = feedback ? (feedback.feedback ?? feedback.items ?? []) : null;
  const [prefill] = useState(prefillFromUrl);
  const [composing, setComposing] = useState(
    () =>
      Boolean(prefill.context) ||
      Boolean(prefill.requestId) ||
      Boolean(prefill.sendId),
  );
  const [now] = useState(() => Date.now());
  const invalidate = useInvalidate();
  // Sent feedback moves the rail's count too.
  const load = () => {
    invalidate(keys.feedback);
    invalidate(keys.me);
  };

  const rows = (items ?? []).map((f) => [
    {
      text: `fb_${f.feedback_id}`,
      onClick: () => navigate(path(`/account/feedback/${f.feedback_id}`)),
    },
    {
      text: ago(f.created_at, now),
      title: stamp(f.created_at, { year: true }),
    },
    (f.category ?? "general").replaceAll("_", " "),
    { text: firstLine(f.message), title: f.message },
    TONE[f.status]
      ? { text: f.status, tone: TONE[f.status] }
      : (f.status ?? ""),
    f.response
      ? {
          text: "replied",
          title: f.responded_at ? `replied ${day(f.responded_at)}` : "",
        }
      : "—",
  ]);

  return (
    <LogTable
      loading={feedbackQuery.isPending}
      error={
        feedbackQuery.isError
          ? "Your feedback could not be read just now; try again shortly."
          : null
      }
      title="Feedback"
      note={
        scoped
          ? "What this agent has told us, and what we did about it. New feedback is filed as you, from your own console."
          : "What you have told us, and what we did about it. Every item gets a response; nothing is actioned invisibly."
      }
      actions={
        scoped ? null : (
          <button
            className="btn btn--primary"
            onClick={() => setComposing((v) => !v)}
          >
            <Icon name="plus" size={16} />
            Send feedback
          </button>
        )
      }
      above={
        composing && !scoped ? (
          <Compose
            onSent={load}
            onClose={() => setComposing(false)}
            context={prefill.context}
            requestId={prefill.requestId}
            sendId={prefill.sendId}
          />
        ) : null
      }
      cols={[
        ["ID", "left"],
        ["WHEN", "left"],
        ["CATEGORY", "left"],
        ["SAID", "left"],
        ["STATE", "left"],
        ["REPLY", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1]}
      filters={[
        { key: "category", label: "Category", col: 2 },
        { key: "state", label: "State", col: 4 },
      ]}
      empty={
        scoped
          ? "Nothing filed by this agent yet. It files with elixir_send_feedback."
          : "Nothing filed yet — your agent can file too, with elixir_send_feedback."
      }
      footnote="Open an item to read the whole note and the maintainer's reply. A filed note cannot be edited; send another if something changed."
    />
  );
}
