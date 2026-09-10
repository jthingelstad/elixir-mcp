import { useEffect, useState } from "react";
import { api } from "../../api.js";

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
      <div className="panel">
        <div className="panel__body">
          No feedback item #{id} on your account.{" "}
          <a onClick={() => navigate("/account/feedback")}>All feedback ›</a>
        </div>
      </div>
    );
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <a
          className="mono"
          style={{ fontSize: "12px" }}
          onClick={() => navigate("/account/feedback")}
        >
          ‹ All feedback
        </a>
      </p>
      <section className="panel" style={{ maxWidth: "640px" }}>
        <div className="panel__head">
          <span className="mono" style={{ color: "var(--ink-faint)" }}>
            #{item.feedback_id}
          </span>
          <span className="tag-chip">{item.category}</span>
          <span
            className={`chip ${
              item.status === "done"
                ? "chip--active"
                : item.status === "new"
                  ? "chip--pending"
                  : ""
            }`}
          >
            {item.status}
          </span>
          <span
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--ink-faint)",
            }}
          >
            filed {item.created_at?.slice(0, 10)} · via {item.surface}
          </span>
        </div>
        <div
          className="panel__body"
          style={{ fontSize: "13px", lineHeight: 1.6 }}
        >
          {item.message}
        </div>
        {item.response ? (
          <div
            className="panel__body"
            style={{ borderTop: "1px solid var(--line-soft)" }}
          >
            <div
              className="mono"
              style={{
                fontSize: "11px",
                color: "var(--ink-faint)",
                marginBottom: "6px",
              }}
            >
              MAINTAINER RESPONSE
              {item.responded_at ? ` · ${item.responded_at.slice(0, 10)}` : ""}
            </div>
            <div style={{ fontSize: "12.5px", lineHeight: 1.6 }}>
              {item.response}
            </div>
            {item.shipped_in && (
              <p style={{ marginTop: "8px" }}>
                <a
                  className="mono"
                  style={{ fontSize: "11.5px" }}
                  onClick={() => navigate("/data/changelog")}
                >
                  shipped in {item.shipped_in} ›
                </a>
              </p>
            )}
          </div>
        ) : (
          <div
            className="panel__foot"
            style={{ fontSize: "12px", color: "var(--ink-faint)" }}
          >
            Awaiting a maintainer response — every item gets one, and a response
            lands in your event feed.
          </div>
        )}
      </section>
    </>
  );
}

export function Feedback({ navigate }) {
  const [items, setItems] = useState(null);
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const load = () =>
    api
      .myFeedback()
      .then((r) => r.ok && setItems(r.data.feedback ?? r.data.items ?? []));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="cols">
      <div className="cols__main">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Your feedback</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--ink-faint)",
              }}
            >
              never actioned invisibly
            </span>
          </div>
          {items?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--ink-faint)" }}>
              Nothing filed yet — your agent can file too, with{" "}
              <code>elixir_feedback</code>.
            </div>
          )}
          {(items ?? []).map((f) => (
            <div
              key={f.feedback_id}
              style={{
                padding: "12px 16px",
                borderTop: "1px solid var(--line-soft)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <a
                  className="mono"
                  style={{ fontSize: "11.5px" }}
                  onClick={() => navigate(`/account/feedback/${f.feedback_id}`)}
                >
                  #{f.feedback_id} ›
                </a>
                <span className="tag-chip">{f.category}</span>
                <span
                  className={`chip ${
                    f.status === "done"
                      ? "chip--active"
                      : f.status === "new"
                        ? "chip--pending"
                        : ""
                  }`}
                >
                  {f.status}
                </span>
                {f.shipped_in && (
                  <a
                    className="mono"
                    style={{ fontSize: "11.5px" }}
                    onClick={() => navigate("/data/changelog")}
                  >
                    shipped in {f.shipped_in} ›
                  </a>
                )}
                <span
                  className="mono"
                  style={{
                    marginLeft: "auto",
                    fontSize: "11px",
                    color: "var(--ink-faint)",
                  }}
                >
                  {f.created_at?.slice(0, 10)}
                </span>
              </div>
              <div
                style={{
                  fontSize: "12.5px",
                  marginTop: "6px",
                  color: "var(--ink-body)",
                }}
              >
                {f.message}
              </div>
              {f.response && (
                <div
                  style={{
                    marginTop: "8px",
                    paddingLeft: "12px",
                    borderLeft: "2px solid var(--line-strong)",
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                  }}
                >
                  {f.response}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
      <div className="cols__rail">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Send feedback</span>
          </div>
          <div
            className="panel__body"
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {sent ? (
              <div className="notice">Received — thank you.</div>
            ) : (
              <>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {[
                    "general",
                    "bug",
                    "data_quality",
                    "feature",
                    "praise",
                    "other",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={5}
                  placeholder="Wrong-looking data, missing capability, praise…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div>
                  <button
                    className="btn"
                    disabled={!message.trim()}
                    onClick={async () => {
                      const r = await api.sendFeedback(message, category);
                      if (r.ok) {
                        setSent(true);
                        load();
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
