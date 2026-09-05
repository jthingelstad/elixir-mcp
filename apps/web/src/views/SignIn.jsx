import { useEffect, useState } from "react";
import { api } from "../api.js";

export function SignIn({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email | code | redeeming
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  // A magic link lands here as /signin?login_token=...
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get(
      "login_token",
    );
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
