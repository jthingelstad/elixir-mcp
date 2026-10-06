import { useId, useRef, useState } from "react";

/** A message draft, never a public annotation. Only the public projection
 * and the player's deliberately typed words enter the outbound message. */
export function PlayerBattleShare({ url, players }) {
  const id = useId();
  const [step, setStep] = useState("closed");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const sending = useRef(false);
  // Use the server's canonical battle link, never the current page URL:
  // a visited URL can carry unrelated query or fragment credentials.
  if (
    !/^https:\/\/elixir\.poapkings\.com\/battle\/[a-f0-9]{12,64}$/.test(
      url ?? "",
    )
  )
    return null;
  const title = `${players} — Clash Royale battle`;
  const words = context.trim();
  const text = words ? `Why this mattered to me\n${words}\n\n${title}` : title;
  const message = `${text}\n${url}`;

  function cancel() {
    setContext("");
    setNotice("");
    setError("");
    setStep("closed");
  }

  async function send(kind) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "share") {
        await navigator.share({ title, text, url });
        setNotice("Shared.");
      } else {
        if (!navigator.clipboard?.writeText)
          throw new Error("clipboard_unavailable");
        await navigator.clipboard.writeText(message);
        setNotice("Message copied.");
      }
    } catch (err) {
      if (kind === "share" && err?.name === "AbortError")
        setNotice("Share canceled. Your preview is still here.");
      else
        setError(
          kind === "share"
            ? "Sharing did not finish. You can try again or copy the message."
            : "Copy did not finish. Select the message below and copy it yourself, or try again.",
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (step === "closed")
    return (
      <button
        type="button"
        className="btn btn--sm mt-3"
        onClick={() => setStep("edit")}
      >
        Share with your context
      </button>
    );

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold mb-2">Your battle, in your words</h3>
      <p className="footnote mb-3">
        Your words travel with the message. The link opens the recorded battle
        anyone can read.
      </p>
      {step === "edit" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setStep("preview");
            setNotice("");
            setError("");
          }}
        >
          <label htmlFor={id} className="field-label">
            Why did this battle matter to you? (optional)
          </label>
          <textarea
            id={id}
            rows={4}
            maxLength={500}
            value={context}
            onChange={(event) => setContext(event.target.value)}
            aria-describedby={`${id}-limit`}
          />
          <p id={`${id}-limit`} className="footnote mt-1">
            {context.length}/500 · Only the words you write here join the
            message.
          </p>
          <div className="share-actions flex-wrap">
            <button className="btn btn--sm btn--gold" type="submit">
              Preview message
            </button>
            <button className="btn btn--sm" type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <label htmlFor={`${id}-preview`} className="field-label">
            Message preview
          </label>
          <textarea id={`${id}-preview`} readOnly rows={7} value={message} />
          <div className="share-actions flex-wrap">
            <button
              className="btn btn--sm btn--gold"
              type="button"
              disabled={busy}
              onClick={() => send("copy")}
            >
              Copy message
            </button>
            {typeof navigator.share === "function" && (
              <button
                className="btn btn--sm"
                type="button"
                disabled={busy}
                onClick={() => send("share")}
              >
                Share message
              </button>
            )}
            <button
              className="btn btn--sm"
              type="button"
              disabled={busy}
              onClick={() => {
                setNotice("");
                setError("");
                setStep("edit");
              }}
            >
              Back to edit
            </button>
            <button
              className="btn btn--sm"
              type="button"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
          {notice && (
            <p className="footnote mt-2" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
