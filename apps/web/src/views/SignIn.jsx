import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { takeLoginToken } from "../url-hygiene.js";

/**
 * Sign in, or ask to — one card, six states.
 *
 * Email, then code, and two escapes from the code step that this page
 * spent a long time without: a typo in the address left you waiting for
 * mail that was never coming, and a spent code had no way back.
 *
 * Two more exist because both used to render as "expired or already
 * used", which is only one of them. A LINK that is expired says so and
 * says nothing is wrong with the account. An account whose access
 * request is still WAITING now gets its own answer, because sending
 * somebody round a loop that cannot work is worse than telling them the
 * gate is deliberate.
 *
 * THE HANDOFF (0083, 2026-09-12). The screen that asks for the email
 * keeps asking whether the link has been opened somewhere else - the
 * phone's mail app, another browser - and signs itself in when it has.
 * Before this, clicking the link on the phone left the desktop tab on
 * the code step, waiting for a code the click had already spent. And a
 * screen that opens a link from a different address than the one that
 * asked is shown the asking screen's country and time and asked whether
 * to sign that one in too: somebody who clicks a link they never
 * requested is the person best placed to say no.
 *
 * THE SIXTH IS THE ACCESS REQUEST, moved here 2026-09-10 because the
 * two doors are one decision: you are either signing in or asking to.
 * It lived on the static home page as a second implementation with its
 * own fetch and its own error strings, and it BROKE SILENTLY — the POST
 * landed, the row was created, and the success path set `.hidden` on a
 * form carrying inline `display: flex` and on a `.notice` whose class
 * sets `display: flex`, neither of which a `hidden` attribute can beat.
 * The page did not move. A visitor could not tell the difference between
 * "sent" and "did nothing", so they went away. Here the result is state,
 * and state renders.
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

/** The home page's "Request access" button is a link to /signin?request,
 *  so a visitor who came to ask lands on the asking half rather than on
 *  a sign-in form for the account they are trying to get. A query, not a
 *  path: /signin is the one route this app owns here, and everything
 *  under it must keep reporting nothing to analytics. */
const initialStep = () =>
  new URLSearchParams(window.location.search).has("request")
    ? "request"
    : "email";

export function SignIn({ onAuthed }) {
  const [email, setEmail] = useState("");
  // email | request | code | redeeming | expired | pending
  const [step, setStep] = useState(initialStep);
  const [playerTag, setPlayerTag] = useState("");
  const [note, setNote] = useState("");
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

  // A magic link lands here as /signin?login_token=... — read from the value
  // lifted out of the URL at boot, not from the URL itself, which by now has
  // deliberately had the credential removed.
  useEffect(() => {
    const token = takeLoginToken();
    if (!token) return;
    setStep("redeeming");
    api.redeemToken(token).then((res) => {
      if (!res.ok)
        return setStep(
          res.data?.error === "not_approved" ? "pending" : "expired",
        );
      if (res.data?.handoff?.state === "confirm") {
        setHandoff(res.data.handoff);
        return setStep("handoff");
      }
      onAuthed();
    });
  }, [onAuthed]);

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
        onAuthedRef.current();
      }
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [step, asked]);

  async function sendEmail(e) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    const res = await api.sendLoginEmail(email);
    setBusy(false);
    setAsked(res.ok ? res.data : null);
    setStep("code");
  }

  /** The API answers 200 identically for a new request, a repeat, a
   *  denied one and an already-approved address — deliberately, so this
   *  form cannot be used to ask who has an account. So the confirmation
   *  is the same card the pending state uses: true for all four, and one
   *  copy instead of two that drift. */
  async function sendRequest(e) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    const res = await api.requestAccess({
      email,
      player_tag: playerTag,
      note,
    });
    setBusy(false);
    if (res.ok) return setStep("pending");
    setError(
      res.data?.error === "invalid_tag"
        ? "That doesn't look like a CR tag."
        : res.data?.error === "rate_limited"
          ? "Too many requests — try again shortly."
          : "Something went wrong — try again.",
    );
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
            await api.confirmHandoff(handoff.confirm);
            setBusy(false);
            onAuthed();
          }}
        >
          {busy ? "Signing it in…" : "Yes, that was me"}
        </button>
        <button
          className="btn"
          style={{ ...primary, marginTop: "10px" }}
          disabled={busy}
          onClick={() => onAuthed()}
        >
          No, just here
        </button>
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

  if (step === "request")
    return (
      <div style={card}>
        <h1 className="page__title" style={{ fontSize: "28px" }}>
          Request access
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
          Access is granted by hand while the recorder grows. Tell us who you
          are in the arena.
        </p>
        <form onSubmit={sendRequest}>
          <label className="field-label" htmlFor="request-email">
            Email
          </label>
          <input
            id="request-email"
            type="email"
            required
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={field}
          />
          <label className="field-label" htmlFor="request-tag">
            Your player tag
          </label>
          <input
            id="request-tag"
            className="mono"
            required
            placeholder="#20JJJ2CCRU"
            value={playerTag}
            onChange={(e) => setPlayerTag(e.target.value)}
            style={field}
          />
          <label className="field-label" htmlFor="request-note">
            Anything we should know?{" "}
            <span style={{ color: "var(--ink-faint)" }}>(optional)</span>
          </label>
          <input
            id="request-note"
            placeholder="Playing daily, want to run a collector…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={field}
          />
          {error && <p className="field-error">{error}</p>}
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy}
            style={primary}
          >
            {busy ? "Sending…" : "Request access"}
          </button>
        </form>
        <p className="footnote" style={{ margin: "16px 0 0" }}>
          Already approved?{" "}
          <a
            onClick={() => {
              setError("");
              setStep("email");
            }}
          >
            Sign in instead
          </a>
          .
        </p>
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
              If your account is approved, one is on its way to{" "}
              <span style={{ color: "var(--ink)" }}>{email}</span>.{" "}
            </>
          )}
          Click the link, or type the code here. Opening the link on another
          device signs this screen in too.
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
          the gate is deliberate, not broken. The other door is a step of
          this card now, not a link back to the static home. */}
      <p
        className="footnote"
        style={{ margin: "16px 0 0", textWrap: "pretty" }}
      >
        No account yet?{" "}
        <a
          onClick={() => {
            setError("");
            setStep("request");
          }}
        >
          Request access
        </a>{" "}
        — it is granted by hand while the corpus grows, on what you can bring to
        the beta: playing actively, running a collector, connecting an agent and
        telling us where it struggles.
      </p>
    </div>
  );
}
