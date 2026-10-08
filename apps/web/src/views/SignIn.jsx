import { Icon, writeErrorText } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { consumeLoginToken } from "../url-hygiene.js";
import { CONSOLE } from "../lib/console.js";

/** One email door for sign-in and public member signup. Email verification
 * opens a new account; collector admission and recording quotas are separate.
 * Link/code redemption and the cross-device confirmation remain single-use. */
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

// A form draft, never an account preference. Keep an unchecked choice through
// an interrupted request/reload; the server freezes it in each emailed proof.
const PRODUCT_NEWS_DRAFT = "elixir.signup_product_news";
function finishSignIn(onAuthed) {
  try {
    window.sessionStorage.removeItem(PRODUCT_NEWS_DRAFT);
  } catch {
    // Storage is optional; email proof still carries the selected choice.
  }
  return onAuthed();
}

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
  const [productNews, setProductNews] = useState(() => {
    try {
      return window.sessionStorage.getItem(PRODUCT_NEWS_DRAFT) !== "off";
    } catch {
      return true;
    }
  });
  // email | code | redeeming | expired | pending | handoff
  const [step, setStep] = useState("email");
  const submitting = useRef(false);
  const creating =
    new URLSearchParams(window.location.search).has("signup") ||
    new URLSearchParams(window.location.search).has("request");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // What the API said when the email was asked for: the poll id this
  // screen holds, and whether the send was refused for the hour.
  const [asked, setAsked] = useState(null);
  // A link opened here from a different address than the screen that
  // asked: { confirm, started } until answered.
  const [handoff, setHandoff] = useState(null);
  // The poll below must not restart every render (App hands down a fresh
  // onAuthed each time), so it reads the latest through a ref.
  const onAuthedRef = useRef(onAuthed);
  useEffect(() => {
    onAuthedRef.current = onAuthed;
  });

  // A magic link lands here as /signin#login_token=... — read from the value
  // lifted out of the URL at boot, not from the URL itself, which by now has
  // deliberately had the credential removed.
  //
  // ONCE, full stop: consumeLoginToken() gives the token to one caller.
  // This used to depend on onAuthed - a fresh arrow every render - and
  // read a memoised token, so each re-render of this page while the
  // session settled redeemed it again: four redeems in 600 ms live
  // (2026-09-13), three of them 400s on a spent token, and a 400 sets
  // "expired" - a race the navigation happened to win. A remount cannot
  // redeem twice either.
  useEffect(() => {
    const token = consumeLoginToken();
    if (!token) return;
    setStep("redeeming");
    api.redeemToken(token).then((res) => {
      if (!res.ok && (res.error || res.status >= 500)) {
        setError(
          writeErrorText({
            status: res.status,
            transport: res.error,
            data: res.data,
          }),
        );
        return setStep("link_error");
      }
      if (!res.ok)
        return setStep(
          res.data?.error === "not_approved" ? "pending" : "expired",
        );
      if (res.data?.handoff?.state === "confirm") {
        setHandoff(res.data.handoff);
        return setStep("handoff");
      }
      finishSignIn(onAuthedRef.current);
    });
  }, []);

  // While the code step waits, ask every four seconds whether the link
  // was opened somewhere else and allowed; the link's own fifteen
  // minutes bound it. A collected handoff IS the sign-in.
  useEffect(() => {
    if (step !== "code" || !asked?.poll_id) return undefined;
    let stopped = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (stopped || Date.now() - startedAt > 15 * 60 * 1000)
        return clearInterval(timer);
      const res = await api.pollSignIn(asked.poll_id);
      if (stopped) return;
      if (res.ok && res.data?.ready) {
        clearInterval(timer);
        finishSignIn(onAuthedRef.current);
      }
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [step, asked]);

  async function sendEmail(e) {
    e?.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    const res = await api.sendLoginEmail(email, productNews);
    submitting.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(
        res.data?.error === "bad_request"
          ? "Enter a valid email address."
          : writeErrorText({
              status: res.status,
              transport: res.error,
              data: res.data,
            }),
      );
      return;
    }
    setAsked(res.data);
    setCode("");
    setStep("code");
  }

  if (step === "redeeming")
    return (
      <div style={card}>
        <p style={{ margin: 0, color: "var(--ink-dim)" }}>Signing you in…</p>
      </div>
    );

  if (step === "handoff")
    return (
      <div style={card}>
        <Eyebrow icon="circle-check" tone="ok">
          signed in here
        </Eyebrow>
        <h1 className="page__title" style={{ fontSize: "26px" }}>
          Also sign in where you started?
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
          This sign-in was asked for from a different place
          {handoff?.started?.client ? ` (${handoff.started.client}` : ""}
          {handoff?.started?.country
            ? `${handoff?.started?.client ? ", " : " ("}${handoff.started.country}`
            : ""}
          {handoff?.started?.client || handoff?.started?.country ? ")" : ""}
          {handoff?.started?.at
            ? ` at ${new Date(handoff.started.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : ""}
          . If that was you, sign it in too. If it was not, leave it out.
        </p>
        <button
          className="btn btn--primary"
          style={primary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const r = await api.confirmHandoff(handoff.confirm);
            setBusy(false);
            // A confirmation that did not take says so and stays here:
            // moving on would read as the other screen being signed in.
            if (!r.ok)
              return setError(
                writeErrorText({
                  status: r.status,
                  transport: r.error,
                  data: r.data,
                }),
              );
            finishSignIn(onAuthed);
          }}
        >
          {busy ? "Signing it in…" : "Yes, that was me"}
        </button>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn"
          style={{ ...primary, marginTop: "10px" }}
          disabled={busy}
          onClick={() => finishSignIn(onAuthed)}
        >
          No, just here
        </button>
      </div>
    );

  if (step === "expired" || step === "link_error")
    return (
      <div style={{ ...card, borderColor: "var(--warn-edge)" }}>
        <Eyebrow icon="circle-dashed" tone="warn">
          {step === "link_error" ? "sign-in interrupted" : "link expired"}
        </Eyebrow>
        <h1 className="page__title" style={{ fontSize: "26px" }}>
          {step === "link_error"
            ? "Sign-in did not finish"
            : "That link is expired or already used"}
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
          {step === "link_error"
            ? "Elixir did not confirm this sign-in. Request a new email to continue."
            : "Links are single-use, and they do not last long. Nothing is wrong with your account."}
          {step === "link_error" && <span role="alert">{error}</span>}
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
          account access
        </Eyebrow>
        <h1 className="page__title" style={{ fontSize: "26px" }}>
          Account access is unavailable
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
          This account cannot sign in.{" "}
          <a href="mailto:admin@poapkings.com">Contact Elixir</a> if you think
          this is a mistake. A new email request does not remove an account
          restriction.
        </p>
        <div
          style={{
            borderTop: "1px solid var(--line-soft)",
            paddingTop: "16px",
            fontSize: "13.5px",
            color: "var(--ink-body)",
          }}
        >
          Meanwhile, <a href={`${CONSOLE}/data/dashboard`}>the data page</a> and{" "}
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
          {asked?.limited ? (
            <span style={{ color: "var(--warn)" }}>{asked.message} </span>
          ) : (
            <>
              Check for a sign-in link or code at{" "}
              <span style={{ color: "var(--ink)" }}>{email}</span>.{" "}
            </>
          )}
          Click the link, or type the code here. Opening the link on another
          device may ask you to confirm this screen before signing it in too.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setError("");
            setBusy(true);
            const res = await api.redeemCode(email, code);
            submitting.current = false;
            setBusy(false);
            if (res.ok) return finishSignIn(onAuthed);
            if (res.data?.error === "not_approved") return setStep("pending");
            setError(
              res.status >= 500 || res.error
                ? writeErrorText({
                    status: res.status,
                    transport: res.error,
                    data: res.data,
                  })
                : "Wrong or expired code.",
            );
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
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
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
          <button
            type="button"
            className="link"
            onClick={() => {
              setError("");
              setCode("");
              setStep("email");
            }}
          >
            Use a different address
          </button>
          <button type="button" className="link" onClick={sendEmail}>
            Send another email
          </button>
        </div>
        <p className="footnote" style={{ margin: "14px 0 0" }}>
          Five tries, then the code is spent. The link expires either way.
        </p>
      </div>
    );

  return (
    <div style={card}>
      <h1 className="page__title" style={{ fontSize: "28px" }}>
        {creating
          ? "Create your Elixir account"
          : "Sign in or create an account"}
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
        We email you a link and a six-digit code. Verify either to open your
        account. No password, invitation or collector needed.
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
        <label className="mb-2 flex items-start gap-2 text-[13px] text-ink-body">
          <input
            type="checkbox"
            className="mt-[3px] shrink-0"
            checked={productNews}
            aria-describedby="signin-product-news-note"
            onChange={(e) => {
              const checked = e.target.checked;
              setProductNews(checked);
              try {
                window.sessionStorage.setItem(
                  PRODUCT_NEWS_DRAFT,
                  checked ? "on" : "off",
                );
              } catch {
                // A resend in this mounted form still keeps the choice.
              }
            }}
          />
          Send me Elixir product news
        </label>
        <p id="signin-product-news-note" className="footnote mb-4">
          For a new account only. Existing newsletter choices stay the same.
          Sign-in and welcome mail still arrive; reports have separate controls.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy}
          style={primary}
        >
          {busy ? "Sending…" : "Send sign-in email"}
        </button>
      </form>
      <p
        className="footnote"
        style={{ margin: "16px 0 0", textWrap: "pretty" }}
      >
        New here? After signing in, add your player under Console ▸ Tracking.
        Product news is your choice above. Reports have their own off switches.
        See <a href="/docs/privacy">Privacy</a> and{" "}
        <a href="/docs/email">Emails</a>. Collectors need separate approval;
        recording stays within your account's limits.
      </p>
    </div>
  );
}
