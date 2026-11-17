import { useEffect, useId, useRef, useState } from "react";
import { ConfirmAction, Link, PlayerName, useClock } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useMe } from "../App.jsx";
import {
  itemSubjects,
  useCommentsChanged,
  useItemComments,
} from "../lib/queries.js";
import { playerHref } from "../lib/player.js";
import { useScope } from "../lib/scope.js";
import {
  COMMENT_MAX,
  REPORT_REASONS,
  commentsCountLabel,
} from "./comment-set.js";

/**
 * Comments on a timeline item (2026-11-16): the server half is
 * services/web-api/src/comments.mjs, its rules
 * docs/notes/2026-11-16-comments.md. Nothing draws while comments are off
 * (`/api/me` `features.comments`), under an agent's scope, or on an item
 * that takes none (`it.comments === null`: nobody verified the player it
 * is about).
 *
 * Home's feed hands each item `comments: { count, latest, open }`: the
 * card shows the newest two and the way in. A player page's or a battle
 * page's item has no such field; its thread opens on a tap and reads then.
 *
 * The words are other people's: drawn as plain text, never as links,
 * Markdown or tags.
 */
/** A question post (2026-11-17) takes answers: the same comments, with
 *  "Answer" as the way in. */
const isQuestion = (it) => it?.kind === "post" && it?.post?.question === true;

export function useCommentsOn() {
  const { me } = useMe();
  const scope = useScope();
  return !scope && me?.features?.comments === true;
}

export function Comments({ it }) {
  const on = useCommentsOn();
  const summary = it?.comments;
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const threadId = useId();
  if (!on || !it?.id || summary === null) return null;

  const onCard = summary !== undefined;
  const count = summary?.count ?? 0;
  const latest = summary?.latest ?? [];
  return (
    <section className="kit-comments" aria-label="Comments">
      {onCard && !open && latest.length ? (
        <ul className="kit-comments__list">
          {latest.map((c) => (
            <CommentRow key={c.id} c={c} it={it} />
          ))}
        </ul>
      ) : null}
      {open ? <Thread id={threadId} it={it} focus={writing} /> : null}
      <div className="kit-comments__bar">
        {!onCard || count > latest.length || open ? (
          <button
            type="button"
            className="kit-chip kit-comments__more"
            aria-expanded={open}
            aria-controls={open ? threadId : undefined}
            onClick={() => {
              setWriting(false);
              setOpen(!open);
            }}
          >
            {open ? "Hide comments" : commentsCountLabel(onCard ? count : null)}
          </button>
        ) : null}
        {onCard && summary.open && !open ? (
          <button
            type="button"
            className="kit-chip kit-comments__more"
            onClick={() => {
              setWriting(true);
              setOpen(true);
            }}
          >
            {isQuestion(it) ? "Answer" : "Comment"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The whole thread, read when it opens, with the box to add one when
 *  the owner's setting lets you. */
function Thread({ id, it, focus }) {
  const read = useItemComments(it, true);
  const data = read.data;
  return (
    <div id={id} className="kit-comments__thread">
      {read.isPending ? (
        <p className="kit-tiny" role="status">
          Reading comments.
        </p>
      ) : read.isError ? (
        <p className="kit-tiny" role="status">
          {read.error?.status === 404
            ? "Comments show here for players in your feed."
            : "Comments couldn't be read just now."}
        </p>
      ) : (
        <>
          {data.comments.length ? (
            <ul className="kit-comments__list">
              {data.comments.map((c) => (
                <CommentRow key={c.id} c={c} it={it} />
              ))}
            </ul>
          ) : (
            <p className="kit-tiny">No comments yet.</p>
          )}
          {data.open ? (
            <Composer it={it} autoFocus={focus} />
          ) : (
            <p className="kit-tiny">Comments on this one are closed to you.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Write one: 280 characters, checked before it posts. A no says why in
 *  one plain line and keeps the words, so they can be changed. */
export function Composer({ it, autoFocus = false }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const changed = useCommentsChanged();
  const fieldId = useId();
  const left = COMMENT_MAX - [...text].length;
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  const send = async (e) => {
    e.preventDefault();
    if (busy || !text.trim() || left < 0) return;
    setBusy(true);
    setError(null);
    const res = await api.postComment({
      item_id: it.id,
      subjects: itemSubjects(it),
      text,
    });
    setBusy(false);
    if (res.ok) {
      setText("");
      changed(it.id);
      return;
    }
    setError(res.data?.message ?? "Your comment wasn't posted. Try again.");
    box.current?.focus();
  };
  return (
    <form className="kit-comments__form" onSubmit={send}>
      <textarea
        id={fieldId}
        ref={box}
        aria-label={isQuestion(it) ? "Your answer" : "Your comment"}
        className="kit-comments__field"
        rows={2}
        maxLength={COMMENT_MAX * 2}
        placeholder={isQuestion(it) ? "Your answer" : "Say something nice"}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${fieldId}-help`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="kit-comments__send">
        <span
          id={`${fieldId}-help`}
          className={left < 0 ? "field-error" : "kit-tiny"}
        >
          {left < 0 ? `${-left} too many` : `${left} left`}
        </span>
        <button
          type="submit"
          className="btn btn--sm btn--primary"
          disabled={busy || !text.trim() || left < 0}
        >
          {busy ? "Checking" : "Post"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** One comment: who, when, the words, and what you may do about it. */
function CommentRow({ c, it }) {
  const { when } = useClock();
  const changed = useCommentsChanged();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const name = c.author?.name ?? c.author?.player_tag ?? "A player";
  const theirs = c.author?.player_tag ? (
    <Link to={playerHref(c.author.player_tag)} className="kit-comments__who">
      <PlayerName
        tag={c.author.player_tag}
        verified={c.author.verified ? true : undefined}
      >
        {name}
      </PlayerName>
    </Link>
  ) : (
    <span className="kit-comments__who">{name}</span>
  );
  if (reported)
    return (
      <li className="kit-comments__item kit-tiny" role="status">
        Thanks. You won't see that comment now.
      </li>
    );
  const ownerRemoves = c.can_delete && !c.mine;
  return (
    <li className="kit-comments__item">
      <p className="kit-comments__head">
        {theirs}
        {c.at ? <span className="kit-tiny"> · {when(c.at)}</span> : null}
      </p>
      <p className="kit-comments__text">{c.text}</p>
      <div className="kit-comments__acts">
        {c.can_delete ? (
          <ConfirmAction
            label={ownerRemoves ? "Remove" : "Delete"}
            className="btn btn--quiet btn--sm"
            title={
              ownerRemoves ? "Remove this comment?" : "Delete your comment?"
            }
            body={
              ownerRemoves
                ? "It goes from your item for everyone. Elixir keeps it 30 days in case it needs a look."
                : "It goes for good."
            }
            confirm={ownerRemoves ? "Remove" : "Delete"}
            run={() => api.deleteComment(c.id)}
            onDone={(out) => {
              if (out?.ok) changed(it.id);
            }}
          />
        ) : null}
        {c.can_report ? (
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            aria-expanded={reporting}
            onClick={() => setReporting(!reporting)}
          >
            Report
          </button>
        ) : null}
        {c.can_block ? (
          <ConfirmAction
            label="Block"
            className="btn btn--quiet btn--sm"
            title={`Block ${name}?`}
            body="You won't see each other's comments, and they can't comment on your play or cheer it. Any follows between you end. They won't be told. Battles and player pages stay as they are."
            confirm="Block"
            run={() => api.block({ comment_id: c.id })}
            onDone={(out) => {
              if (out?.ok) changed(it.id, { everything: true });
            }}
          />
        ) : null}
      </div>
      {reporting ? (
        <ReportForm
          id={c.id}
          subjects={itemSubjects(it)}
          onDone={() => {
            setReported(true);
            changed(it.id);
          }}
        />
      ) : null}
    </li>
  );
}

/** Why you report it: one reason. You stop seeing it at once; two reports
 *  hide it until an admin looks. Its writer is never told. */
export function ReportForm({ id, subjects, onDone, run = null }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const groupId = useId();
  const send = async (e) => {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    const res = run
      ? await run(reason)
      : await api.reportComment(id, reason, subjects);
    setBusy(false);
    if (res.ok) onDone();
    else setError("Your report wasn't sent. Try again.");
  };
  return (
    <form className="kit-comments__report" onSubmit={send}>
      <fieldset aria-labelledby={groupId}>
        <legend id={groupId} className="kit-tiny">
          What's wrong with it?
        </legend>
        <div className="kit-comments__reasons">
          {REPORT_REASONS.map((r) => (
            <label key={r.key} className="kit-comments__reason">
              <input
                type="radio"
                name={`reason-${id}`}
                value={r.key}
                checked={reason === r.key}
                onChange={() => setReason(r.key)}
              />{" "}
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="btn btn--sm" disabled={!reason || busy}>
        Send report
      </button>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
