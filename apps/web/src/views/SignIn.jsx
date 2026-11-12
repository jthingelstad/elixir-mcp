import { Icon, browserZone, clockAt, writeErrorText } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { consumeLoginToken } from "../url-hygiene.js";
import { useTurnstile } from "../turnstile.js";
import { discordOutcome, discordStartHref } from "../discord.js";

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
// The server's words for a send refused for want of a Turnstile token
// (TURNSTILE_REFUSED_MESSAGE in packages/auth).
const TURNSTILE_REFUSED =
  "Elixir could not confirm a person asked for this email. Reload the page and try again.";
// A proof for an address with no account, from plain sign-in, which does
// not ask the 13-or-older question (#763): the signup form asks it, and a
// new email follows.
const AGE_NOTICE =
  "There’s no Elixir account for that address yet. To create one, answer the question below and we’ll send a new email.";

/** What a send is waiting for while Cloudflare's box is on screen: the form
 *  says so beside the box, never a bare "Sending…" (turnstile.js, 2026-11-09). */
function ChallengeWait({ waiting }) {
  return waiting === "challenge" ? (
    <p className="footnote mt-2 mb-3" role="status">
      Cloudflare is asking for one click to check that a person is sending this.
      Answer the box above and the email goes.
    </p>
  ) : null;
}
/** `newAccount` is the server's word that this proof opened the account
 *  ({ player_tag } or null otherwise): App lands a new person on it. */
function finishSignIn(onAuthed, newAccount = null) {
  try {
    window.sessionStorage.removeItem(PRODUCT_NEWS_DRAFT);
  } catch {
    // Storage is optional; email proof still carries the selected choice.
  }
  return onAuthed(newAccount ?? null);
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

export function SignIn({
  search = typeof window === "undefined" ? "" : window.location.search,
  onAuthed,
  /** Sign-in with Discord is configured (/api/me features, #531). */
  discordLogin = false,
}) {
  // What a Discord round trip that came back here says (#531).
  const fromDiscord = discordOutcome(search, "signin");
  const [email, setEmail] = useState("");
  const [productNews, setProductNews] = useState(true);
  useEffect(() => {
    try {
      setProductNews(
        window.sessionStorage.getItem(PRODUCT_NEWS_DRAFT) !== "off",
      );
    } catch {
      // Storage is optional.
    }
  }, []);
  // email | code | redeeming | expired | pending | handoff
  const [step, setStep] = useState("email");
  // Asks Cloudflare whether a person is sending the email (turnstile.js).
  const {
    slot: turnstileSlot,
    warm: warmTurnstile,
    tokenFor: turnstileToken,
    waiting: turnstileWaiting,
  } = useTurnstile();
  const submitting = useRef(false);
  // The signup form: `?signup` (and the retired `?request`), or "New
  // here?" from plain sign-in. Only it asks for a player tag.
  const [creating, setCreating] = useState(
    () =>
      new URLSearchParams(search).has("signup") ||
      new URLSearchParams(search).has("request") ||
      fromDiscord?.outcome === "age",
  );
  // The signup form's "Are you 13 or older?" (VISION; #763): null until
  // answered. A "no" sends nothing and keeps nothing: the form stops here.
  const [age, setAge] = useState(null);
  // Why the form came back after a proof (AGE_NOTICE), or "".
  const [notice, setNotice] = useState("");
  const [playerTag, setPlayerTag] = useState("");
  // What the proof said about a new account, held while a cross-device
  // handoff is answered first.
  const newAccount = useRef(null);
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
      if (res.data?.error === "age_attestation_required") return askAge();
      if (!res.ok)
        return setStep(
          res.data?.error === "not_approved" ? "pending" : "expired",
        );
      newAccount.current = res.data?.new_account ?? null;
      if (res.data?.handoff?.state === "confirm") {
        setHandoff(res.data.handoff);
        return setStep("handoff");
      }
      finishSignIn(onAuthedRef.current, newAccount.current);
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

  /** Back to the signup form, with the question, after a proof that would
   *  have opened an account nobody said was 13 or older. */
  function askAge() {
    setCreating(true);
    setAge(null);
    setCode("");
    setError("");
    setNotice(AGE_NOTICE);
    setStep("email");
  }

  async function sendEmail(e) {
    e?.preventDefault();
    if (submitting.current) return;
    // The signup form sends nothing until the question has a yes.
    if (creating && age !== "yes") return;
    submitting.current = true;
    setError("");
    setBusy(true);
    const res = await api.sendLoginEmail(
      email,
      productNews,
      browserZone(),
      creating ? playerTag : "",
      await turnstileToken(email),
      creating && age === "yes",
    );
    submitting.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(
        res.data?.error === "invalid_tag"
          ? "That doesn't look like a player tag. Check it, or leave it empty and add your player after signing in."
          : res.data?.error === "turnstile_failed"
            ? TURNSTILE_REFUSED
            : res.data?.error === "bad_request"
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
            ? ` at ${clockAt(handoff.started.at, browserZone())}`
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
            finishSignIn(onAuthed, newAccount.current);
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
          onClick={() => finishSignIn(onAuthed, newAccount.current)}
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
          Meanwhile, <a href="/data">Status and data</a> and{" "}
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
            if (res.ok)
              return finishSignIn(onAuthed, res.data?.new_account ?? null);
            if (res.data?.error === "not_approved") return setStep("pending");
            if (res.data?.error === "age_attestation_required") return askAge();
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
        <div ref={turnstileSlot} />
        <ChallengeWait waiting={turnstileWaiting} />
        <p className="footnote mt-3.5 mb-0">
          The code allows five attempts. After that, request another email.
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
        We’ll email you a sign-in link and a six-digit code. Use either to
        continue.
      </p>
      {fromDiscord && !notice && (
        <p className="field-error" role="alert">
          {fromDiscord.text}
        </p>
      )}
      {notice && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}
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
          onFocus={warmTurnstile}
          onInput={warmTurnstile}
          onChange={(e) => setEmail(e.target.value)}
          style={field}
        />
        {creating && (
          <>
            <label className="field-label" htmlFor="signin-player-tag">
              Your player tag (optional)
            </label>
            <input
              id="signin-player-tag"
              className="mono"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="#2PYQ8GJ0"
              aria-describedby="signin-player-tag-hint"
              value={playerTag}
              onChange={(e) => setPlayerTag(e.target.value)}
              style={field}
            />
            <p id="signin-player-tag-hint" className="footnote -mt-2 mb-4">
              In Clash Royale, open your profile: the tag starting with # is
              below your name. Elixir starts recording it once you verify your
              email. Leave it empty to add your player after signing in.
            </p>
            <fieldset className="m-0 mb-4 border-0 p-0">
              <legend className="field-label">Are you 13 or older?</legend>
              <div className="flex gap-5 text-[14px] text-ink-body">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="signin-age"
                    value="yes"
                    required
                    checked={age === "yes"}
                    onChange={() => setAge("yes")}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="signin-age"
                    value="no"
                    checked={age === "no"}
                    onChange={() => setAge("no")}
                  />
                  No
                </label>
              </div>
              {age === "no" ? (
                <p className="footnote mt-2 mb-0" role="status">
                  Elixir accounts are for people 13 or older, so we can’t create
                  one for you. Nothing was sent or saved.
                </p>
              ) : (
                <p className="footnote mt-2 mb-0">
                  Elixir accounts are for people 13 or older.
                </p>
              )}
            </fieldset>
          </>
        )}
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
        <div ref={turnstileSlot} />
        <ChallengeWait waiting={turnstileWaiting} />
        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy || (creating && age === "no")}
          style={primary}
        >
          {!busy
            ? "Send sign-in email"
            : turnstileWaiting === "challenge"
              ? "Waiting for the check…"
              : "Sending…"}
        </button>
      </form>
      {/* On the signup form, only once the question has a yes. */}
      {discordLogin && (!creating || age === "yes") && (
        <a
          className="btn mt-3 w-full justify-center py-3 text-[15px]"
          href={discordStartHref({
            intent: "signin",
            zone: browserZone(),
            news: productNews,
            age: creating && age === "yes",
          })}
        >
          Continue with Discord
        </a>
      )}
      <p className="footnote mt-4 mb-0 text-pretty">
        {creating ? (
          "A tag you give is for a new account only; one you already have keeps its players. "
        ) : (
          <>
            New here?{" "}
            <button
              type="button"
              className="link"
              onClick={() => setCreating(true)}
            >
              Create an account
            </button>{" "}
            and add your player tag as you do.{" "}
          </>
        )}
        Reports have their own off switches. See{" "}
        <a href="/docs/privacy">Privacy</a>, <a href="/docs/email">Emails</a>{" "}
        and <a href="/docs/terms">Terms</a>.
      </p>
    </div>
  );
}
