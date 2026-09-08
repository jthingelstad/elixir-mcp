import { useEffect, useState } from "react";
import { api } from "../api.js";
import { takeLoginToken } from "../url-hygiene.js";

/**
 * Sign in.
 *
 * This page was assembled out of raw elements while the rest of the app grew
 * a design system around it, and it showed: the form sat directly inside the
 * panel with no `panel__body`, so the text ran into the panel's edge; the
 * submit buttons carried no class at all and rendered as the browser's own
 * grey chrome; and the beta note was a `panel__note` with its padding
 * cancelled by an inline style, which is the shape of a component being
 * fought rather than used.
 *
 * It now uses the same primitives as the request-access form it sits
 * opposite: labelled fields in a spaced column, the standard primary action,
 * and the beta note in the panel foot where notes go. NOT gold: gold is the
 * nav's entry affordance and the two brand moments, not every submit.
 */
const column = { display: "flex", flexDirection: "column", gap: "10px" };

export function SignIn({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email | code | redeeming
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A magic link lands here as /signin?login_token=... — read from the value
  // lifted out of the URL at boot, not from the URL itself, which by now has
  // deliberately had the credential removed.
  useEffect(() => {
    const token = takeLoginToken();
    if (!token) return;
    setStep("redeeming");
    api.redeemToken(token).then((res) => {
      if (res.ok) onAuthed();
      else {
        setError("That link is expired or already used — request a fresh one.");
        setStep("email");
      }
    });
  }, [onAuthed]);

  async function sendEmail(e) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    await api.sendLoginEmail(email);
    setBusy(false);
    setStep("code");
  }

  return (
    <div className="panel" style={{ maxWidth: "420px", margin: "48px auto 0" }}>
      <div className="panel__head">
        <span className="panel-title">Sign in</span>
      </div>

      {step === "redeeming" && (
        <div className="panel__body">
          <p className="notice" style={{ margin: 0 }}>
            <span>Signing you in…</span>
          </p>
        </div>
      )}

      {step === "email" && (
        <>
          <div className="panel__body" style={column}>
            <div style={{ fontSize: "12.5px", color: "var(--faint)" }}>
              We&rsquo;ll email a sign-in link and a 6-digit code to your
              approved address.
            </div>
            <form onSubmit={sendEmail} style={column}>
              <label>
                <span className="label">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {error && <p className="field-error">{error}</p>}
              <div>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send sign-in email"}
                </button>
              </div>
            </form>
          </div>
          {/* Said here rather than only on the request form, because this is
              where somebody arrives believing they already have an account —
              and the honest answer to "why can't I sign in" is usually that
              the gate is deliberate, not broken. In the panel foot, which is
              what panel__note is for. */}
          <p className="panel__note" style={{ margin: 0 }}>
            Elixir MCP is in{" "}
            <strong style={{ color: "var(--ink)" }}>beta</strong> and accounts
            are approved by hand. New people are admitted on what they can bring
            to the beta &mdash; playing actively, running a collector,
            connecting an agent and telling us where it struggles.{" "}
            <a href="/#request">Request access</a> if you don&rsquo;t have an
            account yet.
          </p>
        </>
      )}

      {step === "code" && (
        <>
          <div className="panel__body" style={column}>
            {/* .notice is a flex row with a rule down its left edge, so every
                ELEMENT child becomes a column of its own -- an inline <strong>
                here split the sentence into three. One child, always. */}
            <p className="notice" style={{ margin: 0 }}>
              <span>
                If your account is approved, an email is on its way to{" "}
                <strong>{email}</strong>. Click the link, or enter the code
                here.
              </span>
            </p>
            <form
              style={column}
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setBusy(true);
                const res = await api.redeemCode(email, code);
                setBusy(false);
                if (res.ok) onAuthed();
                else setError("Wrong or expired code.");
              }}
            >
              <label>
                <span className="label">6-digit code</span>
                <input
                  className="mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              {error && <p className="field-error">{error}</p>}
              <div>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </form>
          </div>
          {/* Both dead ends this page used to have: a typo in the address left
              you waiting for mail that was never coming, and a code that
              expired had no way back. */}
          <p className="panel__note" style={{ margin: 0 }}>
            <a
              onClick={() => {
                setError("");
                setCode("");
                setStep("email");
              }}
            >
              Use a different address
            </a>
            {" · "}
            <a onClick={sendEmail}>Send another email</a>
          </p>
        </>
      )}
    </div>
  );
}
