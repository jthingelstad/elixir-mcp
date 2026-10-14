import { useWrite } from "@elixir-mcp/client";
import { Disclosure, Icon, Link, useClock, WriteError } from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { keys, useEmailPrefs } from "../../lib/queries.js";
import { CONSOLE } from "../../lib/console.js";

/** What each email is, in a line, and the one condition worth saying
 *  under it. The names are the API's (KIND_LABELS); the product chip
 *  and the send time are the API's too, from the mail package, so the
 *  page and the mail's own pill and footer cannot disagree. */
const ABOUT = {
  clan_report: {
    what: "Your clan's week: the war race, joins and departures.",
    note: "for each clan you track",
  },
  arena_week: {
    what: "Your record by mode, decks and opponents.",
    note: "skipped in a week none of your players battled",
  },
  tracking_report: {
    what: "How everyone you follow played.",
  },
  collector_activity: {
    what: "What your collectors recorded.",
    note: "only if you run one",
  },
  milestone: {
    what: "Big firsts in your players’ records.",
  },
  clan_actions_waiting: {
    what: "Actions in your clan waiting for your decision.",
    note: "only if you can act on it",
  },
  feedback_answer: {
    what: "An unread answer to feedback you filed.",
  },
};

const SOURCE_ICON = {
  Clan: "users",
  Ladder: "chart-line",
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

/** Parts of an instant in the account's zone; a zone this browser does
 *  not know reads as UTC rather than failing the page. */
function partsIn(zone, at, opts) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone || "UTC",
      ...opts,
    }).formatToParts(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      ...opts,
    }).formatToParts(at);
  }
}
const part = (parts, type) => parts.find((p) => p.type === type)?.value ?? "";

/** "Tue Sep 29": a send's day where the reader is. */
function sentDay(ts, zone) {
  const p = partsIn(zone, new Date(ts), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${part(p, "weekday")} ${part(p, "month")} ${part(p, "day")}`;
}

function Source({ product }) {
  if (!product) return null;
  return (
    <span className="mail-source">
      <Icon name={SOURCE_ICON[product] ?? "mail"} size={12} />
      {product}
    </span>
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
  const { zone } = useClock();
  const query = useEmailPrefs();
  const { data, isLoading } = query;
  const kinds = data?.kinds ?? [];
  const pref = useWrite(api.setEmailPref, { invalidate: [keys.email] });
  const flip = (kind, enabled) => pref.run(kind, enabled);
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
        to={`${CONSOLE}/account/activity/e/${k.last_send_id}`}
      >
        The last one ›
      </Link>
    ) : null;
  const row = (k) => (
    <li key={k.kind} className="mail-pref__row">
      <div className="mail-pref__body">
        <h3 className="mail-pref__name">
          {k.label} <Source product={k.product} />
        </h3>
        <p className="mail-pref__what">{ABOUT[k.kind]?.what}</p>
        {ABOUT[k.kind]?.note ? (
          <p className="mail-pref__note">{ABOUT[k.kind].note}</p>
        ) : null}
        {latest(k)}
      </div>
      <span className="mail-pref__when">
        {k.sends
          ? `${k.sends.weekday} · ${k.sends.time} ${k.sends.zone}`
          : k.kind === "milestone"
            ? "Checked hourly"
            : k.kind === "clan_actions_waiting"
              ? "After the morning review"
              : "When answered"}
      </span>
      <Switch
        on={k.enabled}
        label={`${k.label} email`}
        disabled={!k.applies || pref.busy}
        onFlip={(on) => flip(k.kind, on)}
      />
    </li>
  );
  return (
    <div className="mailprefs">
      <div className="page__crumb">
        <Link to={`${CONSOLE}/account/profile`}>‹ Profile</Link>
      </div>
      <div className="mailprefs__head">
        <div className="mailprefs__intro">
          <h1 className="page__title">Emails from Elixir</h1>
          <p className="page__lede">Choose what arrives in your inbox.</p>
        </div>
        {kinds.length > 0 ? (
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
        ) : null}
      </div>
      <WriteError error={pref.error} className="field-error mb-3" />
      {query.isError ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Email settings could not be read.{" "}
            <button
              type="button"
              className="btn--text"
              onClick={() => query.refetch()}
            >
              Try again
            </button>
          </span>
        </div>
      ) : null}
      <section className="mail-pref" aria-labelledby="scheduled-email">
        <h2 id="scheduled-email" className="section-title">
          Scheduled
        </h2>
        {isLoading ? (
          <p className="page__lede">Loading…</p>
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
      <section className="mail-pref" aria-labelledby="sent-to-you">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sent-to-you" className="section-title">
            Sent to you
          </h2>
          <Link to={`${CONSOLE}/account/activity/emails`}>All sent ›</Link>
        </div>
        {data?.recent?.length > 0 ? (
          data.recent.slice(0, 4).map((r) => (
            <Link
              key={r.send_id}
              className="mailsent"
              to={`${CONSOLE}/account/activity/e/${r.send_id}`}
            >
              <span className="mailsent__day">{sentDay(r.sent_at, zone)}</span>
              <Source product={product.get(r.kind)} />
              <span className="mailsent__subject">{r.subject ?? r.label}</span>
              <Icon name="chevron-right" size={15} />
            </Link>
          ))
        ) : (
          <p className="page-head__note">Nothing sent yet.</p>
        )}
      </section>
      <Disclosure title="About email delivery">
        <p className="page-head__note m-0">
          Each switch also appears at the foot of its email. Scheduled mail
          sends at most once per kind and subject a day; milestones and feedback
          answers arrive as events happen. Switching mail off leaves recording
          unchanged. Sent records open the email as it was sent; sign-in codes
          are service mail and are not listed here.
        </p>
      </Disclosure>
    </div>
  );
}
