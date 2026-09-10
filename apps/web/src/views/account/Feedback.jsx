import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";

/**
 * Feedback — what you have told us, and what we did about it.
 *
 * Drawn as the 2026-09-09 design draws it: a title with one gold
 * "Send feedback" control beside it, and the items as bare rows on the
 * page, each row a link into its own record. Not a card: the list IS the
 * page, and a panel around it with its own title was the panel-title
 * shape the rail replaced.
 *
 * The compose form is the one thing that opens in place, because a
 * separate page for a textarea is a trip for nothing.
 */

/** One tone per status, read by the list and the record so the two can
 *  never disagree. The design's map: new is unread (accent), planned is
 *  a promise still open (warn), done is kept (ok); seen and declined
 *  carry no tone, because neither asks anything of the reader. */
function statusTone(status) {
  return (
    { new: "chip--info", planned: "chip--warn", done: "chip--ok" }[status] ?? ""
  );
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
      onClick={(e) => {
        e.stopPropagation();
        navigate("/data/changelog");
      }}
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
          #{item.feedback_id}
        </h1>
        <span className={`chip ${statusTone(item.status)}`}>{item.status}</span>
        <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
          {item.category?.replaceAll("_", " ")} ·{" "}
          {item.created_at?.slice(0, 10)}
          {item.surface && item.surface !== "web"
            ? ` · via ${item.surface}`
            : ""}
        </span>
        <Shipped version={item.shipped_in} navigate={navigate} />
      </div>
      <p
        style={{
          fontSize: "16px",
          lineHeight: 1.65,
          color: "var(--ink)",
          margin: "0 0 22px",
          maxWidth: "70ch",
          textWrap: "pretty",
        }}
      >
        {item.message}
      </p>

      {item.response ? (
        <section
          style={{
            borderLeft: "2px solid var(--accent-bright)",
            padding: "2px 0 2px 16px",
          }}
        >
          <div className="label" style={{ marginBottom: "8px" }}>
            Maintainer
            {item.responded_at ? ` · ${item.responded_at.slice(0, 10)}` : ""}
          </div>
          <p
            style={{
              fontSize: "14.5px",
              lineHeight: 1.7,
              color: "var(--ink-body)",
              margin: 0,
              maxWidth: "70ch",
              textWrap: "pretty",
            }}
          >
            {item.response}
          </p>
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

function Compose({ onSent, onClose }) {
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
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
              rows={5}
              aria-label="Message"
              placeholder="Wrong-looking data, a missing capability, praise…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {failed && <p className="field-error">{failed}</p>}
            <div>
              <button
                className="btn btn--primary"
                disabled={!message.trim()}
                onClick={async () => {
                  const r = await api.sendFeedback(message, category);
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
  const [composing, setComposing] = useState(false);
  const load = () =>
    api
      .myFeedback()
      .then((r) => r.ok && setItems(r.data.feedback ?? r.data.items ?? []));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <div>
          <h1 className="page__title">Feedback</h1>
          <p className="page__lede">
            What you have told us, and what we did about it. Every item gets a
            response; nothing is actioned invisibly.
          </p>
        </div>
        <button
          className="btn btn--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setComposing((v) => !v)}
        >
          <Icon name="plus" size={16} />
          Send feedback
        </button>
      </div>

      {composing && (
        <Compose onSent={load} onClose={() => setComposing(false)} />
      )}

      {items?.length === 0 && (
        <div className="empty">
          <p className="empty__body" style={{ marginBottom: 0 }}>
            Nothing filed yet — your agent can file too, with{" "}
            <code>elixir_feedback</code>.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {(items ?? []).map((f) => (
          <a
            key={f.feedback_id}
            href={`/account/feedback/${f.feedback_id}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/account/feedback/${f.feedback_id}`);
            }}
            style={{
              display: "block",
              padding: "14px 2px",
              borderBottom: "1px solid var(--line-row)",
              color: "inherit",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
                marginBottom: "6px",
              }}
            >
              <span className={`chip ${statusTone(f.status)}`}>{f.status}</span>
              <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
                {f.category?.replaceAll("_", " ")}
              </span>
              <Shipped version={f.shipped_in} navigate={navigate} />
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "12px",
                  color: "var(--ink-faint)",
                }}
              >
                {f.created_at?.slice(0, 10)}
              </span>
            </span>
            <span
              style={{
                display: "block",
                fontSize: "14px",
                color: "var(--ink-body)",
                lineHeight: 1.55,
                textWrap: "pretty",
              }}
            >
              {f.message}
            </span>
            {f.response && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  marginTop: "7px",
                  fontSize: "12.5px",
                  color: "var(--accent-bright)",
                }}
              >
                <Icon name="message-square" size={14} />
                maintainer replied
              </span>
            )}
          </a>
        ))}
      </div>
    </>
  );
}
