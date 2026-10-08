import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import { ago, Icon, Link, LogTable, Markdown, useClock } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import {
  keys,
  useInvalidate,
  useMyFeedback,
  useMyFeedbackItem,
} from "../../lib/queries.js";
import { useConsolePath, useScope } from "../../lib/scope.js";
import { CONSOLE } from "../../lib/console.js";

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

/** The part of Elixir an item was written about (0204), as the record
 *  names it. */
const AREA_LABEL = {
  mcp: "MCP",
  api: "JSON API",
  console: "Console",
  ladder: "Ladder",
  clan: "Elixir Clan",
  mail: "Email",
  docs: "Docs",
  recorder: "Recorder",
};
/** The areas a page may file a reply under; a reply to an MCP item
 *  written here is a Console note about it. */
const PAGE_AREAS = new Set(["console", "ladder", "clan", "mail", "docs"]);

/** What a pointer reads as on your own record. Calls and emails are
 *  yours and open; the rest are named. */
const REF_LABEL = {
  player: "Player",
  clan: "Clan",
  clan_action: "Clan action",
  award: "Award",
  policy: "Policy",
};

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
  const scoped = Boolean(useScope());
  const query = useMyFeedbackItem(id);
  const item = query.data?.feedback ?? null;
  const [replying, setReplying] = useState(false);
  const invalidate = useInvalidate();
  if (query.isError)
    return (
      <div className="empty">
        <div className="empty__title">No feedback item #{id}</div>
        <p className="empty__body" style={{ marginBottom: 0 }}>
          Nothing by that number on your account.{" "}
          <Link to={path(`${CONSOLE}/account/feedback`)}>All feedback ›</Link>
        </p>
      </div>
    );
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  const itemPath = (n) => path(`${CONSOLE}/account/feedback/${n}`);
  const refs = item.refs ?? [];
  const calls = refs.filter((r) => r.kind === "call");
  const emails = refs.filter((r) => r.kind === "email");
  const pointers = refs.filter((r) => r.kind !== "call" && r.kind !== "email");
  return (
    <>
      <p className="page__crumb" style={{ marginBottom: "14px" }}>
        <Link to={path(`${CONSOLE}/account/feedback`)}>‹ Feedback</Link>
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
          {AREA_LABEL[item.area] ?? item.area} ·{" "}
          {item.category?.replaceAll("_", " ")} · {day(item.created_at)}
        </span>
        <Shipped version={item.shipped_in} navigate={navigate} />
      </div>

      {item.follows_id && (
        <p className="mt-0 mb-[14px] text-[13px]">
          A reply to{" "}
          <Link className="mono" to={itemPath(item.follows_id)}>
            fb_{item.follows_id}
          </Link>
        </p>
      )}

      <Markdown
        text={item.message}
        style={{
          fontSize: "16px",
          color: "var(--ink)",
          margin: "0 0 22px",
          maxWidth: "70ch",
        }}
      />

      {(calls.length > 0 || emails.length > 0 || pointers.length > 0) && (
        <p style={{ margin: "-12px 0 22px", fontSize: "13px" }}>
          About{" "}
          {[
            ...calls.map((r) => (
              <Link
                key={`c${r.ref}`}
                className="mono"
                to={path(`${CONSOLE}/account/activity/c/${r.ref}`)}
                title="The call, as it was answered"
              >
                call {r.ref.slice(0, 8)}
              </Link>
            )),
            ...emails.map((r) => (
              <Link
                key={`e${r.ref}`}
                className="mono"
                to={`${CONSOLE}/account/activity/e/${r.ref}`}
                title="The email, as it was sent"
              >
                email {r.ref.slice(0, 8)}
              </Link>
            )),
            ...pointers.map((r) => (
              <span key={`${r.kind}${r.ref}`}>
                {REF_LABEL[r.kind] ?? r.kind}{" "}
                <span className="mono">{r.ref}</span>
              </span>
            )),
          ].flatMap((el, i) => (i ? [" · ", el] : [el]))}
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

      {item.followed_by?.length > 0 && (
        <p className="mt-[18px] mb-0 text-[13px]">
          Followed by{" "}
          {item.followed_by
            .map((n) => (
              <Link key={n} className="mono" to={itemPath(n)}>
                fb_{n}
              </Link>
            ))
            .flatMap((el, i) => (i ? [", ", el] : [el]))}
        </p>
      )}

      {/* Answering an answer (0204): a new item that follows this one,
          so the thread reads as one and the reply is answered too. Your
          own console only: an agent replies with elixir_send_feedback. */}
      {item.response && !scoped && (
        <div className="mt-[22px] max-w-[70ch]">
          {replying ? (
            <Compose
              title={`Reply to fb_${item.feedback_id}`}
              area={PAGE_AREAS.has(item.area) ? item.area : "console"}
              category={item.category}
              followsId={Number(item.feedback_id)}
              onSent={() => {
                invalidate(keys.feedback);
                invalidate(keys.me);
              }}
              onClose={() => setReplying(false)}
            />
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => setReplying(true)}
            >
              <Icon name="reply" size={16} />
              Reply
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** What the URL asks the form to open with. The call record links here
 *  with ?request_id=<uuid>, which is a FIELD on the report rather than a
 *  line in the message — it used to arrive as ?context=request_id:<id>
 *  and be pasted into the textarea, where nothing could read it back.
 *  ?context= is still honoured: links to it exist. Read once. */
function prefillFromUrl(search = window.location.search) {
  const q = new URLSearchParams(search);
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
  title = "Send feedback",
  area = "console",
  category: initial = "general",
  followsId = null,
  context = "",
  requestId = "",
  sendId = "",
}) {
  const [category, setCategory] = useState(initial);
  const [message, setMessage] = useState(context ? `${context}\n\n` : "");
  const [sent, setSent] = useState(null);
  const [failed, setFailed] = useState("");
  const path = useConsolePath();
  return (
    <section className="panel" style={{ marginBottom: "18px" }}>
      <div className="panel__head">
        <span className="panel-title">{title}</span>
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
          <div className="notice">
            <span>
              Received — thank you. It is{" "}
              <Link
                className="mono"
                to={path(`${CONSOLE}/account/feedback/${sent}`)}
              >
                fb_{sent}
              </Link>
              ; the answer comes to your email when it lands.
            </span>
          </div>
        ) : (
          <>
            <select
              className="select"
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {FEEDBACK_CATEGORIES.map((c) => (
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
                  const refs = [
                    ...(requestId ? [{ kind: "call", ref: requestId }] : []),
                    ...(sendId ? [{ kind: "email", ref: sendId }] : []),
                  ];
                  const r = await api.sendFeedback({
                    message,
                    category,
                    // An email's report is about the mail (0204).
                    area: sendId ? "mail" : area,
                    ...(refs.length ? { refs } : {}),
                    ...(context ? { context: { context } } : {}),
                    ...(followsId ? { follows_id: followsId } : {}),
                  });
                  if (r.ok) {
                    setSent(String(r.data.feedback_id));
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

export function Feedback({ search } = {}) {
  const { day, stamp } = useClock();
  const path = useConsolePath();
  // An agent's console lists what the AGENT filed (it files with
  // elixir_send_feedback). New feedback is always filed as you, from your
  // own console, so this page has no compose (2026-09-23).
  const scoped = Boolean(useScope());
  const feedbackQuery = useMyFeedback();
  const feedback = feedbackQuery.data;
  const items = feedback ? (feedback.feedback ?? feedback.items ?? []) : null;
  // Router state can render before the address bar updates on navigation.
  const [prefill] = useState(() => prefillFromUrl(search));
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
      href: path(`${CONSOLE}/account/feedback/${f.feedback_id}`),
    },
    {
      text: ago(f.created_at, now),
      title: stamp(f.created_at, { year: true }),
    },
    AREA_LABEL[f.area] ?? f.area ?? "",
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
        ["AREA", "left"],
        ["CATEGORY", "left"],
        ["SAID", "left"],
        ["STATE", "left"],
        ["REPLY", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1]}
      filters={[
        { key: "area", label: "Area", col: 2 },
        { key: "category", label: "Category", col: 3 },
        { key: "state", label: "State", col: 5 },
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
