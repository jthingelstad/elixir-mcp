import { useState } from "react";
import { useWrite } from "@elixir-mcp/client";
import { Icon, Link, useClock, WriteError } from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { keys, useEmailPrefs } from "../../lib/queries.js";
import { CONSOLE } from "../../lib/console.js";

/** What each email is, in a line, and the one condition worth saying
 *  under it. The names are the API's (KIND_LABELS); the product chip
 *  and the send time are the API's too, from the mail package, so the
 *  page and the mail's own pill and footer cannot disagree. */
const ABOUT = {
  clan_report: {
    what: "Your clan's week: the war race, who joined, who left.",
    note: "for each clan you track",
  },
  arena_week: {
    what: "Your record by mode, your decks, who you battled, your other players.",
    note: "skipped in a week none of your players battled",
  },
  tracking_report: {
    what: "How everyone you follow played, mode by mode.",
    note: "was the Tracking report",
  },
  collector_activity: {
    what: "What your Elixir Collectors fetched, and what they earned.",
    note: "only if you run one",
  },
  milestone: {
    icon: "award",
    what: "When you or one of your players reaches something: a new arena, a Path of Legends promotion, a best-trophies mark, a career-wins step, a card or a card form unlocked, a badge. Checked every hour.",
  },
  clan_actions_waiting: {
    icon: "bell-ring",
    what: "When an action in your clan waits for your decision, after Elixir Clan's morning run.",
    note: "only if you can act on it",
  },
};

const SOURCE_ICON = {
  Clan: "users",
  Ladder: "chart-line",
  Friends: "users-round",
  Cards: "layers",
  Collectors: "server",
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
    <span className="mail-src">
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

/**
 * Account › Emails from Elixir: every email Elixir sends, laid out on
 * the week it arrives in, each a switch. Absent preference means on;
 * a switch writes only a change. Its own page (Jamie, 2026-09-19): the
 * switches and the record of what was sent are a subject, not a panel
 * on the profile. The "send me this now" button that sat beside each
 * switch is gone the same day - as a user it made no sense; the
 * operator's test path is the jobs op. Redrawn to the ConsoleEmails
 * board 2026-10-02: the week, the two that come when something
 * happens, the last few sent, and Every email, which sets every kind
 * at once.
 */
export function EmailPage() {
  const { zone } = useClock();
  const { data, isLoading } = useEmailPrefs();
  // Read the clock once per visit, so render stays pure.
  const [now] = useState(() => new Date());
  const kinds = data?.kinds ?? [];
  // A switch that did not take says so; the list refetches only after
  // one that did.
  const pref = useWrite(api.setEmailPref, { invalidate: [keys.email] });
  const flip = (kind, enabled) => pref.run(kind, enabled);

  const weekly = kinds.filter((k) => k.sends);
  const happens = kinds.filter((k) => !k.sends);
  const product = new Map(kinds.map((k) => [k.kind, k.product]));
  const at = weekly[0]?.sends;
  const sendsAt = at ? `${at.time} ${at.zone}` : "14:00 UTC";
  const today = part(partsIn(zone, now, { weekday: "long" }), "weekday");
  const allOn = kinds.length > 0 && kinds.every((k) => k.enabled);
  const onCount = kinds.filter((k) => k.enabled).length;

  const latest = (k) =>
    k.last_send_id ? (
      <Link
        className="mailcard__link"
        to={`${CONSOLE}/account/activity/e/${k.last_send_id}`}
      >
        The last one ›
      </Link>
    ) : null;

  const card = (k) => (
    <div key={k.kind} className={`mailcard${k.applies ? "" : " mailcard--na"}`}>
      <div className="mailcard__top">
        <Source product={k.product} />
        <Switch
          on={k.enabled}
          label={`${k.label} email`}
          disabled={!k.applies}
          onFlip={(on) => flip(k.kind, on)}
        />
      </div>
      <span className="mailcard__name">{k.label}</span>
      <span className="mailcard__what">{ABOUT[k.kind]?.what}</span>
      {ABOUT[k.kind]?.note && (
        <span className="mailcard__note">{ABOUT[k.kind].note}</span>
      )}
      {latest(k)}
    </div>
  );

  return (
    <div className="mailprefs">
      <div className="page__crumb">
        <Link to={`${CONSOLE}/account/profile`}>‹ Profile</Link>
      </div>
      <div className="mailprefs__head">
        <div className="mailprefs__intro">
          <h1 className="page__title">Emails from Elixir</h1>
          <p className="page__lede">
            A letter for each part of your game, one a day, each at {sendsAt}.
            The two below the week arrive when something happens. Every one is
            on until you turn it off, here or from the link at the foot of the
            email.
          </p>
        </div>
        {kinds.length > 0 && (
          <div className="mailall">
            <span className="mailall__label">
              <span className="mailall__name">Every email</span>
              <span className="mailall__note">
                {allOn || onCount === 0
                  ? "to the address you sign in with"
                  : `${onCount} of ${kinds.length} on`}
              </span>
            </span>
            <Switch
              on={allOn}
              label="Every email"
              onFlip={(on) => flip("all", on)}
            />
          </div>
        )}
      </div>
      <WriteError error={pref.error} className="field-error mb-3" />

      <section className="panel mb-[16px]" aria-labelledby="week-in-email">
        <div className="panel__head">
          <h2 id="week-in-email" className="panel-title m-0">
            Your week in email
          </h2>
          <span className="ml-auto text-[12.5px] text-ink-faint">
            {at && at.zone !== "UTC" ? `${sendsAt} · 14:00 UTC` : sendsAt}
          </span>
        </div>
        {isLoading ? (
          <p className="px-4 py-3 text-ink-faint">Loading…</p>
        ) : (
          <div className="mailweek">
            {WEEK.map((day) => {
              const here = weekly.filter((k) => k.sends.weekday === day);
              return (
                <div
                  key={day}
                  className={`mailweek__day${here.length ? "" : " mailweek__day--empty"}`}
                >
                  <span
                    className={`mailweek__dow${day === today ? " mailweek__dow--today" : ""}`}
                  >
                    {day.slice(0, 3)}
                    {day === today && (
                      <span className="chip chip--ok mailweek__today">
                        today
                      </span>
                    )}
                  </span>
                  {here.length ? (
                    here.map(card)
                  ) : (
                    <div className="mailweek__none">nothing</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mailprefs__split">
        <section className="panel" aria-labelledby="as-it-happens">
          <div className="panel__head">
            <h2 id="as-it-happens" className="panel-title m-0">
              When something happens
            </h2>
          </div>
          <div className="px-4">
            {happens.map((k) => (
              <div
                key={k.kind}
                className={`mailhappen${k.applies ? "" : " mailhappen--na"}`}
              >
                <span className="mailhappen__icon">
                  <Icon name={ABOUT[k.kind]?.icon ?? "mail"} size={17} />
                </span>
                <span className="mailhappen__body">
                  <span className="mailhappen__name">
                    {k.label}
                    <Source product={k.product} />
                  </span>
                  <span className="mailcard__what">{ABOUT[k.kind]?.what}</span>
                  {ABOUT[k.kind]?.note && (
                    <span className="mailcard__note">{ABOUT[k.kind].note}</span>
                  )}
                  {latest(k)}
                </span>
                <Switch
                  on={k.enabled}
                  label={`${k.label} email`}
                  disabled={!k.applies}
                  onFlip={(on) => flip(k.kind, on)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="sent-to-you">
          <div className="panel__head">
            <h2 id="sent-to-you" className="panel-title m-0">
              Sent to you
            </h2>
            <Link
              className="ml-auto text-[13px]"
              to={`${CONSOLE}/account/activity/emails`}
            >
              All sent ›
            </Link>
          </div>
          <div className="px-4">
            {data?.recent?.length > 0 ? (
              data.recent.slice(0, 4).map((r) => (
                <Link
                  key={r.send_id}
                  className="mailsent"
                  to={`${CONSOLE}/account/activity/e/${r.send_id}`}
                >
                  <span className="mailsent__day">
                    {sentDay(r.sent_at, zone)}
                  </span>
                  <Source product={product.get(r.kind)} />
                  <span className="mailsent__subject">
                    {r.subject ?? r.label}
                  </span>
                  <Icon name="chevron-right" size={15} />
                </Link>
              ))
            ) : (
              <p className="py-3 m-0 text-[13px] text-ink-faint">
                Nothing sent yet. Each email arrives here as it is sent, with
                its record.
              </p>
            )}
          </div>
          <p className="footnote m-0 px-4 pb-[14px] pt-[10px]">
            Each opens the email as it was sent. Its id is at the foot, which is
            what to quote in feedback. Sign-in codes are service mail and are
            not listed.
          </p>
        </section>
      </div>

      <div className="callout callout--info mt-[16px]">
        <Icon name="mail" size={16} />
        <span>
          Turning an email off here and following its footer link are the same
          switch. Nothing else changes: Elixir keeps recording, and Console,
          Ladder and Clan show the same week.
        </span>
      </div>
    </div>
  );
}
