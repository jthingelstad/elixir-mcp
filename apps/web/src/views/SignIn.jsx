import { useEffect, useState } from "react";
import { api } from "../api.js";
import { takeLoginToken } from "../url-hygiene.js";

export function SignIn({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email | code | redeeming
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

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

  return (
    <div className="panel" style={{ maxWidth: "420px", margin: "48px auto 0" }}>
      <div className="panel__head">
        <span className="panel-title">Sign in</span>
      </div>
      {step === "redeeming" && <p className="notice">Signing you in…</p>}
      {step === "email" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            await api.sendLoginEmail(email);
            setStep("code");
          }}
        >
          <p>
            We&rsquo;ll email a sign-in link and a 6-digit code to your approved
            address.
          </p>
          {/* Said here rather than only on the request form, because this is
              where somebody arrives believing they already have an account —
              and the honest answer to "why can't I sign in" is usually that
              the gate is deliberate, not broken. */}
          <p
            className="panel__note"
            style={{ padding: 0, margin: "0 0 14px", color: "var(--faint)" }}
          >
            Elixir MCP is in{" "}
            <strong style={{ color: "var(--ink)" }}>beta</strong> and accounts
            are approved by hand. New people are admitted on what they can bring
            to the beta &mdash; playing actively, running a collector,
            connecting an agent and telling us where it struggles.{" "}
            <a href="/#request">Request access</a> if you don&rsquo;t have an
            account yet.
          </p>
          <label>
            Email
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button>Send sign-in email</button>
        </form>
      )}
      {step === "code" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const res = await api.redeemCode(email, code);
            if (res.ok) onAuthed();
            else setError("Wrong or expired code.");
          }}
        >
          <p className="notice">
            If your account is approved, an email is on its way to {email}.
            Click the link, or enter the code here.
          </p>
          <label>
            6-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button>Sign in</button>
        </form>
      )}
    </div>
  );
}
