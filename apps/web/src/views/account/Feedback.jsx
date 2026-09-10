import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { LogTable } from "../../components/LogTable.jsx";
import { Markdown } from "../../components/Markdown.jsx";
import { ago } from "../../lib/time.js";

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

function Shipped({ version, navigate }) {
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
      onClick={() => navigate("/data/changelog")}
      title="The contract version this shipped in"
    >
      shipped {version}
    </a>
  );
}

export function FeedbackItem({ id, navigate }) {
  const [item, setItem] = useState(null);
  const [missed, setMissed] = useState(false);
  useEffect(() => {
    api.myFeedback().then((r) => {
      const found = (r.data?.feedback ?? []).find(
        (f) => String(f.feedback_id) === String(id),
      );
      if (found) setItem(found);
      else setMissed(true);
    });
  }, [id]);
  if (missed)
    return (
      <div className="empty">
        <div className="empty__title">No feedback item #{id}</div>
        <p className="empty__body" style={{ marginBottom: 0 }}>
          Nothing by that number on your account.{" "}
          <a onClick={() => navigate("/account/feedback")}>All feedback ›</a>
        </p>
      </div>
    );
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  return (
    <>
      <p className="page__crumb" style={{ marginBottom: "14px" }}>
        <a onClick={() => navigate("/account/feedback")}>‹ Feedback</a>
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
          {item.category?.replaceAll("_", " ")} ·{" "}
          {item.created_at?.slice(0, 10)}
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
            {item.responded_at ? ` · ${item.responded_at.slice(0, 10)}` : ""}
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

/** A prefill carried in the URL: /account/feedback?context=request_id:<id>
 *  opens the form with the id already in the note, because the docs tell
 *  people to quote it and the call record links here. Read once. */
function prefillFromUrl() {
  const context = new URLSearchParams(window.location.search).get("context");
  return context ? String(context).slice(0, 200) : "";
}

function Compose({ onSent, onClose, context = "" }) {
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
  const [items, setItems] = useState(null);
  const [context] = useState(prefillFromUrl);
  const [composing, setComposing] = useState(() => Boolean(context));
  const [now] = useState(() => Date.now());
  const load = () =>
    api
      .myFeedback()
      .then((r) => r.ok && setItems(r.data.feedback ?? r.data.items ?? []));
  useEffect(() => {
    load();
  }, []);

  const rows = (items ?? []).map((f) => [
    {
      text: `fb_${f.feedback_id}`,
      onClick: () => navigate(`/account/feedback/${f.feedback_id}`),
    },
    { text: ago(f.created_at, now), title: f.created_at },
    (f.category ?? "general").replaceAll("_", " "),
    { text: firstLine(f.message), title: f.message },
    TONE[f.status]
      ? { text: f.status, tone: TONE[f.status] }
      : (f.status ?? ""),
    f.response
      ? {
          text: "replied",
          title: f.responded_at ? `replied ${f.responded_at.slice(0, 10)}` : "",
        }
      : "—",
  ]);

  return (
    <LogTable
      title="Feedback"
      note="What you have told us, and what we did about it. Every item gets a response; nothing is actioned invisibly."
      actions={
        <button
          className="btn btn--primary"
          onClick={() => setComposing((v) => !v)}
        >
          <Icon name="plus" size={16} />
          Send feedback
        </button>
      }
      above={
        composing ? (
          <Compose
            onSent={load}
            onClose={() => setComposing(false)}
            context={context}
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
      empty="Nothing filed yet — your agent can file too, with elixir_feedback."
      footnote="Open an item to read the whole note and the maintainer's reply. A filed note cannot be edited; send another if something changed."
    />
  );
}
