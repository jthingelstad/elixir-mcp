import { useEffect, useState } from "react";
import {
  ErrorState,
  Icon,
  PageHead,
  WriteError,
  useClock,
} from "@elixir-mcp/ui";
import { useWrite } from "../../client/index.ts";
import { api } from "../../api.js";
import { keys, usePush } from "../../lib/queries.js";
import {
  pushSupport,
  thisDeviceState,
  turnOff,
  turnOn,
} from "../../lib/push.js";

/** The kinds, in the order the drain picks them, in a player's words. */
export const PUSH_KIND_WORDS = [
  ["cheers", "Cheers on your play", "Counted, never who."],
  ["followers", "New followers", "Counted on your players, never who."],
  [
    "clan_actions",
    "Clan Actions waiting for you",
    "Only if you can act on them.",
  ],
  [
    "answers",
    "Answers to your feedback",
    "A few minutes after they're written.",
  ],
  [
    "close_friends",
    "Close friends' play",
    "When a friend you starred finishes a session. At most three a day.",
  ],
];

function Switch({ on, label, disabled = false, onFlip }) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={label}
      disabled={disabled}
      onClick={() => onFlip(!on)}
    />
  );
}

/**
 * This device: what it can do, read after mount (the page also renders
 * on the server, which has no browser to ask). Permission is asked only
 * inside the tap.
 */
export function ThisDevice({ publicKey, onChange, env = globalThis }) {
  const [support, setSupport] = useState(null);
  const [subscribed, setSubscribed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    let live = true;
    setSupport(pushSupport(env));
    // On only when the browser holds a subscription AND it is this
    // account's device; otherwise the tap registers it again.
    thisDeviceState(api.pushThisDevice, env).then(
      (s) => live && setSubscribed(s.registered),
    );
    return () => {
      live = false;
    };
  }, [env]);
  if (support === null) return null;
  const on = async () => {
    setBusy(true);
    setProblem(null);
    const out = await turnOn(publicKey, api.addPushDevice, env);
    setBusy(false);
    if (out === "on") setSubscribed(true);
    if (out === "denied") setSupport(pushSupport(env));
    if (out === "failed")
      setProblem("That didn't work just now. Try again in a moment.");
    onChange();
  };
  const off = async () => {
    setBusy(true);
    await turnOff(api.pushOff, env).catch(() => null);
    setBusy(false);
    setSubscribed(false);
    onChange();
  };
  let body;
  if (support === "install")
    body = (
      <>
        <p className="push-device__say">
          On iPhone and iPad, notifications come to Elixir on your Home Screen.
        </p>
        <ol className="push-device__steps">
          <li>
            Tap <Icon name="arrow-up-right" size={14} /> Share in Safari.
          </li>
          <li>Tap Add to Home Screen, then Add.</li>
          <li>Open Elixir from your Home Screen and come back here.</li>
        </ol>
      </>
    );
  else if (support === "unsupported")
    body = (
      <p className="push-device__say">
        This browser can't get notifications. Your emails still come.
      </p>
    );
  else if (support === "denied")
    body = (
      <p className="push-device__say">
        Notifications are blocked for Elixir in this browser's settings. Allow
        them there, then come back here.
      </p>
    );
  else if (subscribed)
    body = (
      <div className="push-device__row">
        <p className="push-device__say">
          <Icon name="circle-check" size={16} /> On for this device.
        </p>
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={off}
        >
          Turn off here
        </button>
      </div>
    );
  else
    body = (
      <div className="push-device__row">
        <p className="push-device__say">
          Get a ping when people cheer your play or follow your players.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || subscribed === null}
          onClick={on}
        >
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      </div>
    );
  return (
    <section className="push-device" aria-labelledby="push-this-device">
      <h2 id="push-this-device" className="section-title">
        This device
      </h2>
      {body}
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** Settings › Notifications (2026-11-16): this device, every device the
 *  account has turned on, and a switch per kind. */
export function NotificationsPage({ env = globalThis }) {
  const { whenDay } = useClock();
  const query = usePush();
  const data = query.data;
  const remove = useWrite(api.removePushDevice, { invalidate: [keys.push] });
  const kind = useWrite(api.setPushKind, { invalidate: [keys.push] });
  const devices = data?.devices ?? [];
  return (
    <div className="mailprefs">
      <PageHead
        title="Notification settings"
        sub="How Elixir tells you about cheers, followers, your close friends' play and things waiting for you, on your phone or computer. The notifications themselves are under the bell."
      />
      {query.isError ? (
        <ErrorState
          title="Your notification settings could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Your choices are unchanged. Try again in a moment.
        </ErrorState>
      ) : null}
      {query.isLoading ? (
        <p className="page__lede">Reading your notification choices.</p>
      ) : null}
      {data && !data.offered ? (
        <p className="page__lede">Notifications are off for now.</p>
      ) : null}
      {data?.offered ? (
        <ThisDevice
          publicKey={data.public_key}
          onChange={() => query.refetch()}
          env={env}
        />
      ) : null}
      {data ? (
        <section className="mail-pref" aria-labelledby="push-kinds">
          <h2 id="push-kinds" className="section-title">
            What comes
          </h2>
          <WriteError error={kind.error} className="field-error mb-3" />
          <ul className="mail-pref__list">
            {PUSH_KIND_WORDS.map(([k, label, note]) => (
              <li key={k} className="mail-pref__row">
                <div className="mail-pref__body">
                  <h3 className="mail-pref__name">{label}</h3>
                  <p className="mail-pref__what">{note}</p>
                </div>
                <span className="mail-pref__when" />
                <Switch
                  on={data.kinds?.[k] !== false}
                  label={label}
                  disabled={kind.busy}
                  onFlip={(on) => kind.run(k, on)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data ? (
        <section className="mail-pref" aria-labelledby="push-devices">
          <h2 id="push-devices" className="section-title">
            Your devices
          </h2>
          <WriteError error={remove.error} className="field-error mb-3" />
          {devices.length === 0 ? (
            <p className="page-head__note">
              None yet. Turn notifications on from each phone or computer you
              use.
            </p>
          ) : (
            <ul className="mail-pref__list">
              {devices.map((d) => (
                <li key={d.id} className="push-devices__row">
                  <Icon name="monitor-smartphone" size={18} />
                  <span className="push-devices__body">
                    <span className="push-devices__name">{d.label}</span>
                    <span className="push-devices__when">
                      Added {whenDay(d.created_at)}
                      {d.last_success_at
                        ? ` · last sent ${whenDay(d.last_success_at)}`
                        : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    disabled={remove.busy}
                    aria-label={`Remove ${d.label}`}
                    onClick={() => remove.run(d.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <p className="st-foot">
        Cheers and followers say how many, never who. Close friends' play names
        the friend you starred, and only you get it. At most one every ten
        minutes and eight a day. Tap one to open what it's about. Removing a
        device stops it here; your browser may still list Elixir until you clear
        it there.
      </p>
    </div>
  );
}
