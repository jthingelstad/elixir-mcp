import { useLocation } from "@tanstack/react-router";
import { Icon, Link, writeErrorText } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { keys, useInvalidate } from "../lib/queries.js";
import { SETTINGS } from "../lib/settings.js";
import { DOC_LINKS } from "./doc-links.js";
import { helpFor } from "./help.js";

/** The bar's Help: what this page is, where to read more, and a note about it
 *  that carries the page along. */
export function HelpDrawer({ onClose }) {
  const box = useRef(null);
  const { pathname } = useLocation();
  const help = helpFor(pathname);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [filed, setFiled] = useState(false);
  const invalidate = useInvalidate();

  useEffect(() => {
    const d = box.current;
    if (d && typeof d.showModal === "function" && !d.open) d.showModal();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
    };
  }, []);

  const send = async (e) => {
    e.preventDefault();
    if (busy || !message.trim()) return;
    setBusy(true);
    setFailed("");
    const r = await api.sendFeedback({
      message: message.trim(),
      category: "general",
      area: help.area,
      context: { path: pathname, page: help.title },
    });
    setBusy(false);
    if (!r.ok) {
      setFailed(
        writeErrorText({ status: r.status, transport: r.error, data: r.data }),
      );
      return;
    }
    setFiled(true);
    setMessage("");
    invalidate(keys.feedback);
    invalidate(keys.me);
  };

  const docs = DOC_LINKS[help.docs]?.[1] ?? [];
  return (
    <dialog
      ref={box}
      className="kit-help"
      aria-labelledby="help-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="kit-help__box">
        <header className="kit-help__head">
          <h2 id="help-title">Help for {help.title}</h2>
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        {help.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {docs.length ? (
          <section>
            <h3>Read more</h3>
            <div className="kit-help__links">
              {docs.map(([label, href]) => (
                <a key={href} className="btn btn--sm" href={href}>
                  {label}
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <form onSubmit={send}>
          <h3>
            <label htmlFor="help-note">Something wrong, or missing?</label>
          </h3>
          <p className="kit-tiny">
            The page you are on rides along. Every item is answered, and the
            answer comes to your email and your timeline.
          </p>
          {filed ? (
            <p role="status">
              Received, thank you. Every item is answered, and the answer comes
              to your email when it lands.
            </p>
          ) : (
            <textarea
              id="help-note"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
          {failed ? (
            <p className="kit-form__err" role="alert">
              {failed}
            </p>
          ) : null}
          <div className="kit-help__links">
            {filed ? null : (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || !message.trim()}
              >
                Send
              </button>
            )}
            <Link
              className="btn btn--quiet"
              to={`${SETTINGS}/feedback`}
              onClick={onClose}
            >
              Your feedback and its answers
            </Link>
          </div>
        </form>
      </div>
    </dialog>
  );
}
