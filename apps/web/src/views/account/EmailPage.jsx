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
  digest_daily: {
    what: "A short brief on yesterday: who you follow played or posted, and your clan's race.",
    note: "skipped when there is no news",
  },
  tracking_report: {
    what: "Your week, after Monday's reset: the people you follow, your clan and you.",
    note: "skipped when there is no news",
  },
  digest_season: {
    what: "Your season, when a new one starts: what the people you follow and your clan did.",
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
  activity_today: {
    what: "Cheers on your play and new followers you have not seen yet. Counts only, never who.",
    note: "at most once a day, in your evening",
  },
};

const SOURCE_ICON = {
  Timeline: "house",
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

/** The three digests (2026-11-26), first in Scheduled, in this order;
 *  the clan news switch under them covers all three. */
const DIGESTS = ["digest_daily", "tracking_report", "digest_season"];

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
  const clanPart = useWrite(api.setDigestClanPart, {
    invalidate: [keys.email],
  });
  const flip = (kind, enabled) => pref.run(kind, enabled);
  const digests = DIGESTS.map((d) => kinds.find((k) => k.kind === d)).filter(
    Boolean,
  );
  const anyDigest = digests.some((k) => k.enabled && k.applies);
  const weekly = kinds
    .filter((k) => k.sends && !DIGESTS.includes(k.kind))
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
        The last one <Icon name="chevron-right" size={14} />
      </Link>
    ) : null;
  const when_ = (k) => {
    const note = ABOUT[k.kind]?.note;
    const tail = k.sends
      ? `${k.sends.time} ${k.sends.zone}${note ? ` · ${note}` : ""}`
      : "";
    if (k.sends?.every === "day") return `Daily, ${tail}`;
    if (k.sends?.every === "season") return `When a season starts, ${tail}`;
    if (k.sends)
      return `${k.sends.weekday}s, ${k.sends.time} ${k.sends.zone}${note ? ` · ${note}` : ""}`;
    if (k.kind === "clan_actions_waiting")
      return `When an action becomes yours · ${note}`;
    if (k.kind === "activity_today") return `When people cheer you · ${note}`;
    return "When answered";
  };
  const row = (k) => (
    <li key={k.kind} className="mail-pref__row">
      <div className="mail-pref__body">
        <h3 className="mail-pref__name">
          {k.label} <Source product={k.product} />
        </h3>
        <p className="mail-pref__what">{ABOUT[k.kind]?.what}</p>
        {latest(k)}
      </div>
      <span className="mail-pref__when">{when_(k)}</span>
      <Switch
        on={k.enabled}
        label={`${k.label} email`}
        disabled={!k.applies || pref.busy}
        onFlip={(on) => flip(k.kind, on)}
      />
    </li>
  );
  /** The digests' clan news: one switch for all three, written to the
   *  clan report's row they read. */
  const clanNews =
    digests.length > 0 && typeof data?.clan_part === "boolean" ? (
      <li key="clan_part" className="mail-pref__row">
        <div className="mail-pref__body">
          <h3 className="mail-pref__name">Clan news</h3>
          <p className="mail-pref__what">
            Your clans' races, joins, departures and role changes, in the emails
            above.
          </p>
        </div>
        <span className="mail-pref__when">
          {anyDigest ? "In each one you get" : "Turn one on first"}
        </span>
        <Switch
          on={data.clan_part}
          label="Clan news in these emails"
          disabled={!anyDigest || clanPart.busy}
          onFlip={(on) => clanPart.run(on)}
        />
      </li>
    ) : null;
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
          <ul className="mail-pref__list">
            {digests.map(row)}
            {clanNews}
            {weekly.map(row)}
          </ul>
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
            All sent <Icon name="chevron-right" size={14} />
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
