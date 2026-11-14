import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon, Link, writeErrorText } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { putPassport } from "../lib/passport-reconcile.js";
import { useMyPassport } from "../lib/queries.js";
import { EXTRAS, profileView, stampName } from "./profile-list.js";

/**
 * Home's profile list (#1015): six steps toward All Set, in the place the
 * welcome steps had (they are gone). One compact next step on top, the
 * whole list folded under it. Everything it says comes from the owner's
 * passport read (`owner.profile`); nothing is guessed here.
 *
 *  - Nothing while the read is loading or failed: the feed is never held
 *    back, and a failed read never claims a step is done or not.
 *  - Gone for good once the list is complete (the stored marker), and for
 *    an account that dismissed it. Seen to complete while open, it says
 *    so once, then goes on the next visit.
 *  - An account that finished the older welcome list sees only what is
 *    left, and can put the list away.
 */
export function ProfileList({ first, player, clanTag = null }) {
  const read = useMyPassport();
  const queryClient = useQueryClient();
  const envelope = read.data;
  const body = envelope?.ok ? envelope.data : null;
  const profile = body?.owner?.profile ?? null;
  const view = profileView(profile, {
    playerName: body?.passport?.player?.name ?? player?.name ?? null,
    digest: first?.setup?.digest ?? null,
    clanTag,
  });
  // Seen open on this visit: completing it here says so once.
  const [seenOpen, setSeenOpen] = useState(false);
  if (view && !seenOpen) setSeenOpen(true);
  // Read afresh each time Home opens: a step done elsewhere (Settings'
  // email, picture or players, the clan map) shows done on return, not
  // after the read's 30 seconds of freshness run out.
  useEffect(() => {
    queryClient.invalidateQueries({
      queryKey: ["me", "passport"],
      exact: true,
    });
  }, [queryClient]);
  const put = (res) => putPassport(queryClient, res);
  if (!view) return profile?.complete && seenOpen ? <Finished /> : null;
  return (
    <section className="kit-profile" aria-labelledby="kit-profile-head">
      <div className="kit-profile__head">
        <h2
          id="kit-profile-head"
          // A flex row reads each part as its own word: say it whole.
          aria-label={`Your profile, ${view.done} of ${view.total} done`}
        >
          <span>Your profile</span>
          <span className="kit-profile__count">
            {view.done} of {view.total} done
          </span>
        </h2>
        {view.dismissable ? <Dismiss onDone={put} /> : null}
      </div>
      <p className="kit-profile__lede">
        {view.older
          ? `You finished your welcome. Here’s what’s left for the ${view.allSet} Stamp.`
          : `Finish all six for the ${view.allSet} Stamp.`}
      </p>
      {view.next ? <NextStep step={view.next} onAnswer={put} /> : null}
      <details className="kit-profile__all">
        <summary>
          <Icon name="chevron-right" size={16} />
          {view.older ? "See what’s left" : "See all steps"}
        </summary>
        <ol className="kit-profile__steps">
          {view.steps.map((s) => (
            <StepRow key={s.id} step={s} onAnswer={put} />
          ))}
        </ol>
        <p className="kit-profile__also">Also, any time:</p>
        <ul className="kit-profile__extras">
          {EXTRAS.map((x) => (
            <li key={x.id}>
              <Link to={x.to}>{x.title}</Link>
              <span className="kit-profile__stamp">
                Stamp: {stampName(x.id)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const STATE_WORDS = {
  done: "Done.",
  todo: "To do.",
  unknown: "Waiting on Elixir.",
};

/** The dot: a tick when done, the step's number otherwise. */
function Dot({ step }) {
  return (
    <span className="kit-step__dot" aria-hidden="true">
      {step.state === "done" ? <Icon name="check" size={16} /> : step.n}
    </span>
  );
}

/** The step to do next, with its way in. */
function NextStep({ step, onAnswer }) {
  return (
    <div className="kit-profile__next" data-step={step.id}>
      <Dot step={step} />
      <div className="kit-profile__body">
        <h3>{step.title}</h3>
        {step.stamp ? (
          <p className="kit-profile__stamp">Stamp: {step.stamp}</p>
        ) : null}
        {step.line ? <p>{step.line}</p> : null}
        {step.go || step.notNow ? (
          <div className="kit-profile__go">
            {step.go ? (
              <Link
                to={step.go.to}
                className="btn btn--primary btn--sm"
                aria-label={
                  step.go.name !== step.go.label ? step.go.name : undefined
                }
              >
                {step.go.label}
              </Link>
            ) : null}
            {step.notNow ? <NotNow onAnswer={onAnswer} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One row of the folded list: its dot, title, Stamp, state and way in
 *  (the map's Not now too, wherever the step sits). */
function StepRow({ step, onAnswer }) {
  const done = step.state === "done";
  return (
    <li
      className={`kit-profile__row${done ? " kit-step--done" : ""}${step.state === "unknown" ? " kit-profile__row--wait" : ""}`}
    >
      <Dot step={step} />
      <div className="kit-profile__body">
        <h3>
          {step.title}
          <span className="kit-profile__sr"> {STATE_WORDS[step.state]}</span>
        </h3>
        {step.stamp ? (
          <p className="kit-profile__stamp">Stamp: {step.stamp}</p>
        ) : null}
        {step.line ? <p>{step.line}</p> : null}
        {!done && (step.go || step.notNow) ? (
          <div className="kit-profile__go">
            {step.go ? (
              <Link
                to={step.go.to}
                className="btn btn--sm"
                aria-label={
                  step.go.name !== step.go.label ? step.go.name : undefined
                }
              >
                {step.go.label}
              </Link>
            ) : null}
            {step.notNow ? <NotNow onAnswer={onAnswer} /> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The map step's Not now: done, no On the Map. A failed write keeps the
 *  step as it was and says so. */
function NotNow({ onAnswer }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const res = await api.passportMapNotNow();
          setBusy(false);
          if (!res.ok)
            return setErr(
              writeErrorText({
                status: res.status,
                transport: res.error,
                data: res.data,
              }),
            );
          await onAnswer(res);
        }}
      >
        Not now
      </button>
      {err ? (
        <p className="kit-form__err" role="alert">
          {err}
        </p>
      ) : null}
    </>
  );
}

/** Put the list away (an account that finished the older welcome list). */
function Dismiss({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="kit-profile__dismiss">
      <button
        type="button"
        className="btn btn--sm btn--quiet"
        disabled={busy}
        aria-label="Hide your profile list"
        onClick={async () => {
          setBusy(true);
          setErr("");
          const res = await api.dismissProfileList();
          setBusy(false);
          if (!res.ok)
            return setErr(
              writeErrorText({
                status: res.status,
                transport: res.error,
                data: res.data,
              }),
            );
          await onDone(res);
        }}
      >
        Hide
      </button>
      {err ? (
        <p className="kit-form__err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function Finished() {
  return (
    <section className="kit-profile kit-profile--done" aria-live="polite">
      <div className="kit-profile__next">
        <span className="kit-step__dot" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <div className="kit-profile__body">
          <h3>Your profile is done</h3>
          <p>All six steps. That earns the {stampName("all_set")} Stamp.</p>
        </div>
      </div>
    </section>
  );
}
