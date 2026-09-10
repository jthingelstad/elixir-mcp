import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { takeLoginToken } from "../url-hygiene.js";

/**
 * Sign in — one card, five states.
 *
 * Email, then code, and two escapes from the code step that this page
 * spent a long time without: a typo in the address left you waiting for
 * mail that was never coming, and a spent code had no way back.
 *
 * The other two states exist because both used to render as "expired or
 * already used", which is only one of them. A LINK that is expired says
 * so and says nothing is wrong with the account. An account whose access
 * request is still WAITING now gets its own answer, because sending
 * somebody round a loop that cannot work is worse than telling them the
 * gate is deliberate.
 */
const card = {
  maxWidth: "440px",
  margin: "40px auto 0",
  border: "1px solid var(--line)",
  borderRadius: "16px",
  background: "var(--panel-float)",
  padding: "26px",
  boxShadow: "var(--shadow-modal)",
};
const field = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--ground-sunken)",
  border: "1px solid var(--line-strong)",
  borderRadius: "10px",
  color: "var(--ink)",
  fontSize: "15px",
  padding: "12px 13px",
  marginBottom: "14px",
};
const primary = {
  width: "100%",
  justifyContent: "center",
  padding: "13px",
  borderRadius: "11px",
  fontSize: "15px",
};

function Eyebrow({ icon, tone, children }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        color: `var(--${tone})`,
        fontSize: "13px",
        fontWeight: 600,
        marginBottom: "12px",
      }}
    >
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}

export function SignIn({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email | code | redeeming | expired | pending
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
      else setStep(res.data?.error === "not_approved" ? "pending" : "expired");
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

  if (step === "redeeming")
    return (
      <div style={card}>
        <p style={{ margin: 0, color: "var(--ink-dim)" }}>Signing you in…</p>
      </div>
    );

  if (step === "expired")
    return (
      <div style={{ ...card, borderColor: "var(--warn-edge)" }}>
        <Eyebrow icon="circle-dashed" tone="warn">
          link expired
        </Eyebrow>
        <h1 className="page__title" style={{ fontSize: "26px" }}>
          That link is expired or already used
        </h1>
        <p
          style={{
            fontSize: "14.5px",
            lineHeight: 1.6,
            color: "var(--ink-dim)",
            margin: "8px 0 20px",
            textWrap: "pretty",
          }}
        >
          Links are single-use, and they do not last long. Nothing is wrong with
          your account.
        </p>
        <button
          className="btn btn--primary"
          style={primary}
          onClick={() => {
            setError("");
            setStep("email");
          }}
        >
          Start again
        </button>
      </div>
    );

  if (step === "pending")
    return (
      <div style={card}>
        <Eyebrow icon="circle-dashed" tone="accent-bright">
          waiting on us
        </Eyebrow>
        <h1 className="page__title" style={{ fontSize: "26px" }}>
          Your request is in
        </h1>
        <p
          style={{
            fontSize: "14.5px",
            lineHeight: 1.6,
            color: "var(--ink-dim)",
            margin: "8px 0 18px",
            textWrap: "pretty",
          }}
        >
          Access is granted by hand while the corpus grows. You will get an
          email when your account opens — no need to check back.
        </p>
        <div
          style={{
            borderTop: "1px solid var(--line-soft)",
            paddingTop: "16px",
            fontSize: "13.5px",
            color: "var(--ink-body)",
          }}
        >
          Meanwhile, the corpus is public:{" "}
          <a href="/data/dashboard">the data</a> and{" "}
          <a href="/docs">the docs</a> need no account.
        </div>
      </div>
    );

  if (step === "code")
    return (
      <div style={card}>
        <h1 className="page__title" style={{ fontSize: "28px" }}>
          Check your email
        </h1>
        <p
          style={{
            fontSize: "14.5px",
            lineHeight: 1.6,
            color: "var(--ink-dim)",
            margin: "8px 0 20px",
            textWrap: "pretty",
          }}
        >
          If your account is approved, one is on its way to{" "}
          <span style={{ color: "var(--ink)" }}>{email}</span>. Click the link,
          or type the code here.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            const res = await api.redeemCode(email, code);
            setBusy(false);
            if (res.ok) return onAuthed();
            if (res.data?.error === "not_approved") return setStep("pending");
            setError("Wrong or expired code.");
          }}
        >
          <label className="field-label" htmlFor="signin-code">
            6-digit code
          </label>
          <input
            id="signin-code"
            className="mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{
              ...field,
              fontSize: "24px",
              letterSpacing: ".34em",
              textAlign: "center",
              padding: "14px 13px",
            }}
          />
          {error && <p className="field-error">{error}</p>}
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy}
            style={primary}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {/* Both dead ends this page used to have. */}
        <div
          style={{
            display: "flex",
            gap: "14px",
            flexWrap: "wrap",
            marginTop: "16px",
            fontSize: "13px",
          }}
        >
          <a
            onClick={() => {
              setError("");
              setCode("");
              setStep("email");
            }}
          >
            Use a different address
          </a>
          <a onClick={sendEmail}>Send another email</a>
        </div>
        <p className="footnote" style={{ margin: "14px 0 0" }}>
          Five tries, then the code is spent. The link expires either way.
        </p>
      </div>
    );

  return (
    <div style={card}>
      <h1 className="page__title" style={{ fontSize: "28px" }}>
        Sign in
      </h1>
      <p
        style={{
          fontSize: "14.5px",
          lineHeight: 1.6,
          color: "var(--ink-dim)",
          margin: "8px 0 20px",
          textWrap: "pretty",
        }}
      >
        We email you a link and a six-digit code. No password to keep.
      </p>
      <form onSubmit={sendEmail}>
        <label className="field-label" htmlFor="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          type="email"
          required
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={field}
        />
        {error && <p className="field-error">{error}</p>}
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy}
          style={primary}
        >
          {busy ? "Sending…" : "Send sign-in email"}
        </button>
      </form>
      {/* Said here rather than only on the request form, because this is
          where somebody arrives believing they already have an account —
          and the honest answer to "why can't I sign in" is usually that
          the gate is deliberate, not broken. */}
      <p
        className="footnote"
        style={{ margin: "16px 0 0", textWrap: "pretty" }}
      >
        No account yet? <a href="/#request">Request access</a> — it is granted
        by hand while the corpus grows, on what you can bring to the beta:
        playing actively, running a collector, connecting an agent and telling
        us where it struggles.
      </p>
    </div>
  );
}
