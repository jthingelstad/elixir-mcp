import { useWrite } from "../../client/index.ts";
import {
  ErrorState,
  Icon,
  Link,
  useClock,
  WriteError,
  PageHead,
} from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { keys, useEmailPrefs } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";

/** What each email is, in a line, and the one condition worth saying
 *  under it. The names are the API's (KIND_LABELS); the product chip
 *  and the send time are the API's too, from the mail package, so the
 *  page and the mail's own pill and footer cannot disagree. */
const ABOUT = {
  tracking_report: {
    what: "The people you follow and your clan's week in one email: who played, what they posted and reached, your clan's race, joins and departures, and your own week. Each player once.",
    note: "skipped when there is no news",
  },
  collector_activity: {
    what: "What your collectors recorded.",
    note: "only if you run one",
  },
  clan_actions_waiting: {
    what: "Actions in your clan waiting for you to act on.",
    note: "only if you can act on it",
  },
  feedback_answer: {
    what: "An unread answer to feedback you filed.",
  },
};

const SOURCE_ICON = {
  Home: "house",
  Clan: "users",
  Stats: "chart-line",
  Friends: "users-round",
  Cards: "layers",
  Collectors: "server",
  Account: "user",
};

const WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function Source({ product }) {
  if (!product) return null;
  return (
    <span className="mail-source">
      <Icon name={SOURCE_ICON[product] ?? "mail"} size={12} />
      {product}
    </span>
  );
}

/** The digest's how-often, as one segmented control (the canvas's
 *  Weekly / Daily / Off): Weekly and Daily are its cadence, Off is its
 *  on-off switch. The same two settings and endpoints as before; the one
 *  control replaces the digest's switch. */
const CADENCES = [
  ["weekly", "Weekly"],
  ["daily", "Daily"],
  ["off", "Off"],
];

function Cadence({ value, disabled, onPick }) {
  return (
    <div
      className="segmented mail-pref__cadence"
      role="radiogroup"
      aria-label="How often the digest comes"
    >
      {CADENCES.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v ? "true" : "false"}
          disabled={disabled}
          // The selected one saves too: Weekly is the default, and
          // clicking it is how a person chooses it (Codex on #811).
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

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

/** One row per email: current switch, actual local schedule and sent record. */
export function EmailPage() {
  const { whenDay } = useClock();
  const query = useEmailPrefs();
  const { data, isLoading } = query;
  const kinds = data?.kinds ?? [];
  const pref = useWrite(api.setEmailPref, { invalidate: [keys.email] });
  const cadence = useWrite(api.setDigest, {
    invalidate: [keys.email],
  });
  const clanPart = useWrite(api.setDigestClanPart, {
    invalidate: [keys.email],
  });
  const flip = (kind, enabled) => pref.run(kind, enabled);
  /** The digest's control, one write: Weekly or Daily turns it on at
   *  that cadence, Off turns it off (`setDigest`, Home's write too). */
  const pick = (v) => cadence.run(v);
  const weekly = kinds
    .filter((k) => k.sends)
    .sort(
      (a, b) => WEEK.indexOf(a.sends.weekday) - WEEK.indexOf(b.sends.weekday),
    );
  const happens = kinds.filter((k) => !k.sends);
  const product = new Map(kinds.map((k) => [k.kind, k.product]));
  const allOn = kinds.length > 0 && kinds.every((k) => k.enabled);
  const onCount = kinds.filter((k) => k.enabled).length;
  const latest = (k) =>
    k.last_send_id ? (
      <Link
        className="mail-pref__last"
        to={`${SETTINGS}/emails/${k.last_send_id}`}
      >
        The last one ›
      </Link>
    ) : null;
  const when_ = (k) => {
    const note = ABOUT[k.kind]?.note;
    if (k.sends && k.cadence === "daily")
      return `Daily, ${k.sends.time} ${k.sends.zone}${note ? ` · ${note}` : ""}`;
    if (k.sends)
      return `${k.sends.weekday}s, ${k.sends.time} ${k.sends.zone}${note ? ` · ${note}` : ""}`;
    if (k.kind === "clan_actions_waiting")
      return `When an action becomes yours · ${note}`;
    return "When answered";
  };
  const row = (k) => (
    <li key={k.kind} className="mail-pref__row">
      <div className="mail-pref__body">
        <h3 className="mail-pref__name">
          {k.label} <Source product={k.product} />
        </h3>
        <p className="mail-pref__what">{ABOUT[k.kind]?.what}</p>
        {k.cadence ? (
          <Cadence
            value={k.enabled ? k.cadence : "off"}
            disabled={!k.applies || cadence.busy || pref.busy}
            onPick={pick}
          />
        ) : null}
        {typeof k.clan_part === "boolean" ? (
          <div className="mail-pref__part">
            <span className="mailall__label">
              <span className="mailall__name">Clan news</span>
              <span className="mailall__note">
                Your clans' races, joins, departures and role changes
              </span>
            </span>
            <Switch
              on={k.clan_part}
              label="Clan news in the digest"
              disabled={!k.applies || !k.enabled || clanPart.busy}
              onFlip={(on) => clanPart.run(on)}
            />
          </div>
        ) : null}
        {latest(k)}
      </div>
      <span className="mail-pref__when">{when_(k)}</span>
      {k.cadence ? null : (
        <Switch
          on={k.enabled}
          label={`${k.label} email`}
          disabled={!k.applies || pref.busy}
          onFlip={(on) => flip(k.kind, on)}
        />
      )}
    </li>
  );
  return (
    <div className="mailprefs">
      <PageHead
        title="Emails"
        sub="Choose what arrives in your inbox."
        aside={
          kinds.length > 0 ? (
            <div className="mailall">
              <span className="mailall__label">
                <span className="mailall__name">Every email</span>
                <span className="mailall__note">
                  {onCount} of {kinds.length} on
                </span>
              </span>
              <Switch
                on={allOn}
                label="Every email"
                disabled={pref.busy}
                onFlip={(on) => flip("all", on)}
              />
            </div>
          ) : null
        }
        className="mailprefs__head"
      />
      <WriteError error={pref.error} className="field-error mb-3" />
      <WriteError error={cadence.error} className="field-error mb-3" />
      <WriteError error={clanPart.error} className="field-error mb-3" />
      {query.isError ? (
        <ErrorState
          title="Your email settings could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Your choices are unchanged. Try again in a moment.
        </ErrorState>
      ) : null}
      <section className="mail-pref" aria-labelledby="scheduled-email">
        <h2 id="scheduled-email" className="section-title">
          Scheduled
        </h2>
        {isLoading ? (
          <p className="page__lede">Reading your email choices.</p>
        ) : (
          <ul className="mail-pref__list">{weekly.map(row)}</ul>
        )}
      </section>
      <section className="mail-pref" aria-labelledby="as-it-happens">
        <h2 id="as-it-happens" className="section-title">
          When something happens
        </h2>
        <ul className="mail-pref__list">{happens.map(row)}</ul>
      </section>
      <section className="mail-pref" aria-labelledby="also-email">
        <h2 id="also-email" className="section-title">
          Also
        </h2>
        <p className="page-head__note mb-0">
          Product news: sent through our newsletter service. Every issue has its
          own unsubscribe link.
        </p>
      </section>
      <section className="mail-pref" aria-labelledby="sent-to-you">
        <div className="mail-pref__head flex items-center justify-between gap-3">
          <h2 id="sent-to-you" className="section-title">
            Sent to you
          </h2>
          <Link className="mail-pref__all" to={`${SETTINGS}/emails/sent`}>
            All sent ›
          </Link>
        </div>
        {data?.recent?.length > 0 ? (
          data.recent.slice(0, 4).map((r) => (
            <Link
              key={r.send_id}
              className="mailsent"
              to={`${SETTINGS}/emails/${r.send_id}`}
            >
              <span className="mailsent__day">{whenDay(r.sent_at)}</span>
              <Source product={product.get(r.kind)} />
              <span className="mailsent__subject">{r.subject ?? r.label}</span>
              <Icon name="chevron-right" size={15} />
            </Link>
          ))
        ) : (
          <p className="page-head__note">Nothing sent yet.</p>
        )}
      </section>
      <p className="st-foot">
        Each switch also appears at the foot of its email. Scheduled mail sends
        at most once per kind and subject a day. Answers to your feedback come a
        few minutes after they're written. Switching mail off leaves recording
        unchanged. Sent records open the email as it was sent. Sign-in codes
        always come, and are not listed here.
      </p>
    </div>
  );
}
