import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeErrorText, type WriteFailure } from "./WriteError.tsx";
import { TagText } from "./Tag.tsx";

/**
 * Send feedback from where you are (2026-10-08, feedback is one system):
 * the same sheet in the Console, Ladder and Elixir Clan, filing one
 * record. The page says which part of Elixir it is (`area`) and what the
 * note is about (`refs`: a clan action, an award, a player...), so the
 * person writes only what they think; the place rides along. The kit
 * does not know the API: the surface passes `send`, which posts to
 * `/api/feedback` with its own client.
 */
export interface FeedbackRefInput {
  kind: string;
  ref: string;
}

export interface FeedbackBody {
  message: string;
  category: string;
  area: string;
  refs?: FeedbackRefInput[];
  context?: Record<string, unknown>;
  follows_id?: number;
}

export interface FeedbackSendResult {
  ok: boolean;
  status?: number;
  error?: string | null;
  data?: unknown;
}

export interface FeedbackSheetProps {
  /** The part of Elixir this is about: console, ladder, clan... */
  area: string;
  /** Filed categories, in the order offered (from the contracts). */
  categories: readonly string[];
  /** The one the sheet opens on. */
  category?: string;
  title?: string;
  /** One line on what rides along ("This action, #12."). */
  about?: ReactNode;
  refs?: FeedbackRefInput[];
  /** Where it was written; the path is added when absent. */
  context?: Record<string, unknown>;
  placeholder?: string;
  send: (body: FeedbackBody) => Promise<FeedbackSendResult>;
  onClose: () => void;
  /** Where the filed item can be read, given its id. */
  itemHref?: (id: string) => string;
}

const label = (c: string) => c.replaceAll("_", " ");

export function FeedbackSheet({
  area,
  categories,
  category: initial = "general",
  title = "Send feedback",
  about,
  refs,
  context,
  placeholder = "What worked, what did not, what is missing. Markdown is fine.",
  send,
  onClose,
  itemHref,
}: FeedbackSheetProps) {
  const box = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  // A real modal where the browser has one: Escape, the focus trap and
  // the backdrop come with it. jsdom has the element and not the method.
  useEffect(() => {
    const d = box.current;
    if (d && typeof d.showModal === "function" && !d.open) d.showModal();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setFailed(null);
    const where =
      typeof window === "undefined" ? undefined : window.location.pathname;
    const r = await send({
      message: message.trim(),
      category,
      area,
      ...(refs?.length ? { refs } : {}),
      context: { ...(where ? { path: where } : {}), ...(context ?? {}) },
    });
    setBusy(false);
    const data = r.data as { feedback_id?: unknown } | null | undefined;
    if (r.ok && data?.feedback_id != null) setFiled(String(data.feedback_id));
    else
      setFailed(
        writeErrorText({
          status: r.status,
          transport: r.error,
          data: r.data,
        } as WriteFailure),
      );
  };

  return (
    <dialog
      ref={box}
      className="feedback-sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
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
      <div className="panel__body feedback-sheet__body">
        {filed ? (
          <>
            <div className="notice" role="status">
              <span>
                Received, thank you. Every item is answered, and the answer
                comes to your email when it lands.
              </span>
            </div>
            {itemHref && (
              <p className="feedback-sheet__after">
                <a href={itemHref(filed)}>Read it as fb_{filed}</a>
              </p>
            )}
          </>
        ) : (
          <>
            {about && (
              <div className="notice">
                <TagText>{about}</TagText>
              </div>
            )}
            <select
              className="select"
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
            <textarea
              rows={6}
              aria-label="Message"
              placeholder={placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {failed && (
              <p className="field-error" role="alert">
                {failed}
              </p>
            )}
            <div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !message.trim()}
                onClick={submit}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
