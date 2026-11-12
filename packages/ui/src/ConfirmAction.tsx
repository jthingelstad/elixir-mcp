import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { writeErrorText, type WriteFailure } from "./WriteError.tsx";

/** What a write answers: the client's envelope, its failure on it when
 *  it failed. */
interface Outcome {
  ok?: boolean;
  error?: WriteFailure | null;
  status?: number;
  data?: unknown;
}

/**
 * A button that asks first. A mis-click must not delete, so a destructive
 * action opens one native dialog (and so does a Follow, which spends a slot): it says what happens, Cancel holds the
 * focus, Escape and Cancel do nothing, and only the named button writes. A
 * refused write stays open and says why under its text.
 */
export function ConfirmAction({
  label,
  className = "btn btn--sm",
  title,
  body,
  confirm,
  run,
  onDone,
  disabled = false,
  danger = true,
}: {
  /** The trigger's words. */
  label: ReactNode;
  className?: string;
  title: ReactNode;
  body: ReactNode;
  /** The button that writes. */
  confirm: ReactNode;
  run: () => Promise<Outcome | undefined> | Outcome | undefined;
  onDone?: (outcome: Outcome | undefined) => void;
  disabled?: boolean;
  /** A write that removes something is red; one that adds (a Follow, #764)
   *  asks first in the plain button. */
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = box.current;
    if (!open || !d) return;
    const trigger = document.activeElement;
    if (!d.open) {
      // A native modal owns the focus; a browser without one still shows it.
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    return () => {
      if (d.open && typeof d.close === "function") d.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const go = async () => {
    setBusy(true);
    setError(null);
    let answer: Outcome | undefined;
    try {
      answer = await run();
    } catch {
      setBusy(false);
      setError(writeErrorText({}));
      return;
    }
    setBusy(false);
    if (answer && answer.ok === false) {
      setError(writeErrorText(answer.error ?? answer));
      return;
    }
    setOpen(false);
    onDone?.(answer);
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <dialog
          ref={box}
          className="kit-confirm"
          aria-labelledby={titleId}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) close();
          }}
        >
          <h2 id={titleId} className="kit-confirm__title">
            {title}
          </h2>
          <div className="kit-confirm__body">{body}</div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="kit-confirm__actions">
            <button
              type="button"
              className="btn btn--sm"
              autoFocus
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                danger ? "btn btn--sm btn--danger" : "btn btn--sm btn--primary"
              }
              disabled={busy}
              onClick={go}
            >
              {confirm}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
