import {
  Empty,
  Icon,
  Link,
  LogTable,
  Markdown,
  PageHead,
  Panel,
  Row,
  useClock,
} from "@elixir-mcp/ui";
import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import { useState } from "react";
import { api } from "../../api.js";
import {
  keys,
  useInvalidate,
  useMyFeedback,
  useMyFeedbackItem,
} from "../../lib/queries.js";
import { useScopedPath, useScope } from "../../lib/scope.js";
import { SETTINGS } from "../../lib/settings.js";
import { Crumb } from "./parts.jsx";

/**
 * Feedback: what you have told us, and what we did about it. The list is a
 * log of rows, each opening its record. The
 * record shows the note and the reply in full, rendered as the
 * Markdown they were written in — a note with paragraphs and a list
 * used to arrive as one run of text.
 */

const STATE = {
  new: "New",
  seen: "Seen",
  planned: "Planned",
  needs_info: "Needs info",
  done: "Done",
  declined: "Declined",
};
const stateLabel = (status) => STATE[status] ?? status ?? "";
const KIND = {
  general: "General",
  bug: "Bug",
  data_quality: "Data quality",
  feature: "Feature",
  praise: "Praise",
  judgment: "Judgment",
  other: "Other",
};
const kindLabel = (category) =>
  KIND[category] ?? (category ?? "general").replaceAll("_", " ");

/** One tone per status: new is unread and needs_info is a question waiting
 *  on you, planned is a promise still open, done is kept; seen and declined
 *  carry no tone. */
function statusChip(status) {
  return (
    {
      new: "chip--info",
      needs_info: "chip--info",
      planned: "chip--warn",
      done: "chip--ok",
    }[status] ?? ""
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
  console: "Elixir",
  ladder: "Stats",
  clan: "Clan",
  mail: "Email",
  docs: "Docs",
  recorder: "Recorder",
};
/** The areas a page may file a reply under; a reply to an MCP item
 *  written here is filed under Elixir (stored as `console`). */
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
    <>
      {" · "}
      {/* /updates is a page of the static site, not an app route: a real
          link, or the app's router sent it home. */}
      <a href="/updates" title="The contract version this shipped in">
        Shipped in {version}
      </a>
    </>
  );
}

export function FeedbackItem({ id }) {
  const { whenDay } = useClock();
  const path = useScopedPath();
  const scoped = Boolean(useScope());
  const query = useMyFeedbackItem(id);
  const item = query.data?.feedback ?? null;
  const [replying, setReplying] = useState(false);
  const invalidate = useInvalidate();
  if (query.isError)
    return (
      <Empty
        title={<>No feedback item #{id}</>}
        action={
          <Link className="btn" to={path(`${SETTINGS}/feedback`)}>
            All feedback
          </Link>
        }
      >
        Nothing by that number on your account.
      </Empty>
    );
  if (!item)
    return (
      <p className="text-ink-faint" role="status">
        Reading this item.
      </p>
    );
  const itemPath = (n) => path(`${SETTINGS}/feedback/${n}`);
  const refs = item.refs ?? [];
  const calls = refs.filter((r) => r.kind === "call");
  const emails = refs.filter((r) => r.kind === "email");
  const related = refs.filter((r) => r.kind === "feedback");
  const pointers = refs.filter(
    (r) => r.kind !== "call" && r.kind !== "email" && r.kind !== "feedback",
  );
  return (
    <div className="st-page">
      <PageHead
        crumb={<Crumb to={path(`${SETTINGS}/feedback`)}>Feedback</Crumb>}
        // The id is the title: a filed note has no name of its own, and the
        // number is what a reply and the timeline call it.
        title={
          <>
            <span className="mono">fb_{item.feedback_id}</span>{" "}
            <span className={`chip ${statusChip(item.status)}`}>
              {stateLabel(item.status)}
            </span>
          </>
        }
        sub={
          <>
            {AREA_LABEL[item.area] ?? item.area} · {kindLabel(item.category)} ·{" "}
            {whenDay(item.created_at)}
            <Shipped version={item.shipped_in} />
          </>
        }
      />

      {item.follows_id && (
        <p className="m-0">
          A reply to{" "}
          <Link className="mono" to={itemPath(item.follows_id)}>
            fb_{item.follows_id}
          </Link>
        </p>
      )}

      <Markdown text={item.message} className="st-note-body" />

      {(calls.length > 0 ||
        emails.length > 0 ||
        related.length > 0 ||
        pointers.length > 0) && (
        <p className="m-0">
          About{" "}
          {[
            ...calls.map((r) => (
              <Link
                key={`c${r.ref}`}
                className="mono"
                to={path(`${SETTINGS}/usage/requests/${r.ref}`)}
                title="The call, as it was answered"
              >
                call {r.ref.slice(0, 8)}
              </Link>
            )),
            ...emails.map((r) => (
              <Link
                key={`e${r.ref}`}
                className="mono"
                to={`${SETTINGS}/emails/${r.ref}`}
                title="The email, as it was sent"
              >
                Mail {r.ref.slice(0, 8)}
              </Link>
            )),
            ...related.map((r) => (
              <Link
                key={`f${r.ref}`}
                className="mono"
                to={itemPath(r.ref)}
                title="Related feedback"
              >
                fb_{r.ref}
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
        <section className="st-answer">
          <div className="label">
            Elixir
            {item.responded_at ? ` · ${whenDay(item.responded_at)}` : ""}
          </div>
          <Markdown text={item.response} />
        </section>
      ) : (
        <p className="m-0 text-ink-faint">
          No reply yet. You cannot edit a filed note. Send another if something
          changed.
        </p>
      )}

      {item.followed_by?.length > 0 && (
        <p className="m-0">
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

      {item.related_by?.length > 0 && (
        <p className="m-0">
          Named as related by{" "}
          {item.related_by
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
          own settings only: an agent replies with elixir_send_feedback. */}
      {item.response && !scoped && (
        <div className="max-w-[70ch]">
          {replying ? (
            <Compose
              title={`Reply to fb_${item.feedback_id}`}
              reply
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
              className={item.status === "needs_info" ? "btn btn--gold" : "btn"}
              onClick={() => setReplying(true)}
            >
              <Icon name="reply" size={16} />
              {item.status === "needs_info" ? "Answer the question" : "Reply"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What the URL asks the form to open with. The call record links here
 *  with ?request_id=<uuid>, which is a FIELD on the report rather than a
 *  line in the message — it used to arrive as ?context=request_id:<id>
 *  and be pasted into the textarea, where nothing could read it back.
 *  ?context= is still honoured: links to it exist. Read once. */
function prefillFromUrl(
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const q = new URLSearchParams(search);
  const context = q.get("context");
  return {
    context: context ? String(context).slice(0, 200) : "",
    requestId: q.get("request_id") ? String(q.get("request_id")) : "",
    // The email record links here the same way (?send_id=<uuid>).
    sendId: q.get("send_id") ? String(q.get("send_id")) : "",
    // Profile's "Send feedback" opens the form on arrival.
    send: q.get("send") === "1",
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
  reply = false,
}) {
  const [category, setCategory] = useState(initial);
  const [message, setMessage] = useState(context ? `${context}\n\n` : "");
  const [sent, setSent] = useState(null);
  const [failed, setFailed] = useState("");
  const path = useScopedPath();
  return (
    <Panel
      title={title}
      titleAs="h2"
      action={
        <button type="button" className="btn btn--sm" onClick={onClose}>
          {reply ? "Cancel" : "Close"}
        </button>
      }
    >
      <div className="panel__body st-page">
        {sent !== null ? (
          <div className="notice">
            <span>
              Received, thank you.
              {sent && (
                <>
                  {" "}
                  It is{" "}
                  <Link
                    className="mono"
                    to={path(`${SETTINGS}/feedback/${sent}`)}
                  >
                    fb_{sent}
                  </Link>
                  .
                </>
              )}{" "}
              The answer appears here, and by email if that&rsquo;s on.
            </span>
          </div>
        ) : (
          <>
            <label className="st-field">
              Kind
              <select
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {FEEDBACK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {kindLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            {requestId && (
              <div className="notice">
                <span>
                  Reporting one call,{" "}
                  <span className="mono">{requestId.slice(0, 8)}</span>. Its
                  request, its answer and where the time went ride along with
                  this. You do not have to describe them.
                </span>
              </div>
            )}
            {sendId && (
              <div className="notice">
                <span>
                  Reporting one email, Mail{" "}
                  <span className="mono">{sendId.slice(0, 8)}</span>. The mail
                  as it was sent rides along with this. Say what was wrong or
                  missing in it.
                </span>
              </div>
            )}
            <label className="st-field">
              {reply ? "Your answer" : "What you want to say"}
              <textarea
                rows={6}
                placeholder="Wrong-looking data, a missing capability, praise. Markdown is fine."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {reply ? (
              <p className="hint m-0">
                Sent as a new note, linked to this one. A filed note cannot be
                edited.
              </p>
            ) : null}
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
                    setSent(String(r.data?.feedback_id ?? ""));
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
    </Panel>
  );
}

export function Feedback({ search } = {}) {
  const { when } = useClock();
  const path = useScopedPath();
  // An agent's page lists what the AGENT filed (it files with
  // elixir_send_feedback). New feedback is always filed as you, from your
  // own settings, so this page has no compose (2026-09-23).
  const agent = useScope();
  const scoped = Boolean(agent);
  const feedbackQuery = useMyFeedback();
  const feedback = feedbackQuery.data;
  const items = feedback ? (feedback.feedback ?? feedback.items ?? []) : null;
  // Router state can render before the address bar updates on navigation.
  const [prefill] = useState(() => prefillFromUrl(search));
  const [composing, setComposing] = useState(
    () =>
      prefill.send ||
      Boolean(prefill.context) ||
      Boolean(prefill.requestId) ||
      Boolean(prefill.sendId),
  );
  const invalidate = useInvalidate();
  // Sent feedback moves the rail's count too.
  const load = () => {
    invalidate(keys.feedback);
    invalidate(keys.me);
  };

  const rows = (items ?? []).map((f) => [
    AREA_LABEL[f.area] ?? f.area ?? "",
    kindLabel(f.category),
    stateLabel(f.status),
    f,
  ]);

  return (
    <LogTable
      crumb={
        agent ? (
          <Crumb to={`${SETTINGS}/agents/${agent}/overview`}>Overview</Crumb>
        ) : null
      }
      loading={feedbackQuery.isPending}
      error={
        feedbackQuery.isError
          ? "Your feedback could not be read just now. Try again shortly."
          : null
      }
      title="Feedback"
      note={
        scoped
          ? "What this agent has told us, and what we did about it. New feedback is filed as you, from your own settings."
          : "What you have told us, and what we did about it. Every item gets a response. The answer appears here, and by email if that's on."
      }
      actions={
        scoped ? null : (
          <button
            type="button"
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
        ["Area", "left"],
        ["Kind", "left"],
        ["State", "left"],
      ]}
      rows={rows}
      filters={[
        { key: "area", label: "Area", any: "Every area", col: 0 },
        { key: "kind", label: "Kind", any: "Every kind", col: 1 },
        { key: "state", label: "State", any: "Every state", col: 2 },
      ]}
      renderRow={(row) => {
        const f = row[3];
        return (
          <Row
            title={firstLine(f.message)}
            detail={
              <>
                fb_{f.feedback_id} · {row[0]} · {row[1]} · {when(f.created_at)}
                {f.status === "needs_info" ? (
                  <strong> A question is waiting for you.</strong>
                ) : null}
              </>
            }
            right={
              <span className={`chip ${statusChip(f.status)}`}>{row[2]}</span>
            }
            href={path(`${SETTINGS}/feedback/${f.feedback_id}`)}
          />
        );
      }}
      empty={
        scoped
          ? "Nothing filed by this agent yet. It files with elixir_send_feedback."
          : "Nothing filed yet. Your agent can file too, with elixir_send_feedback. Every item gets a response. The answer appears here, and by email if that's on."
      }
      footnote="Open an item to read the whole note and the answer. A filed note cannot be edited. Send another if something changed."
    />
  );
}
