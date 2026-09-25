import { useClock } from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { keys, useEmailPrefs, useInvalidate } from "../../lib/queries.js";

const BLURB = {
  clan_report:
    "Monday: your clan's week, war result, joins and leaves, the roster.",
  arena_week:
    "Tuesday: your own battles by mode, decks, who you faced. Skipped on a quiet week.",
  tracking_report:
    "Wednesday: everyone you track, you in full, watchers in a line.",
  top_100: "Thursday: one shared read of the global Path of Legends top 100.",
  card_of_week:
    "Friday: one card the record has something to say about, read in full.",
  collector_activity:
    "Sunday: what your collectors fetched and earned. Only if you run one.",
  milestone:
    "As it happens: a new arena, a promotion, a first. Never a move down.",
  clan_actions_waiting:
    "Mornings: from Elixir Clan, when something new in your clan is yours to do. Only if you can act on it.",
};

/**
 * Profile → Email: the eight product emails, each a switch. Absent
 * preference means on; the switch writes only a change. Its own page
 * (Jamie, 2026-09-19): the switches and the record of what was sent
 * are a subject, not a panel on the profile. The "send me this now"
 * button that sat beside each switch is gone the same day - as a user
 * it made no sense; the operator's test path is the jobs op.
 */
export function EmailPage({ navigate }) {
  const { day } = useClock();
  const { data, isLoading } = useEmailPrefs();
  const invalidate = useInvalidate();
  const kinds = data?.kinds ?? [];
  const flip = async (kind, enabled) => {
    await api.setEmailPref(kind, enabled);
    await invalidate(keys.email);
  };
  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/account/profile")}>‹ Profile</a>
      </div>
      <div className="mb-[18px]">
        <h1 className="page__title">Email</h1>
        <p className="page__lede">
          The eight emails Elixir sends. All on by default; every issue carries
          a one-click off for its kind, and turning one off here is immediate
          and yours to reverse.
        </p>
      </div>

      <section className="panel mb-[14px]">
        <div className="panel__head">
          <span className="panel-title">Switches</span>
        </div>
        {isLoading && <p className="px-4 py-3 text-ink-faint">Loading…</p>}
        {kinds.map((k) => (
          <label
            key={k.kind}
            className="flex items-start gap-3 px-4 py-3 border-t border-line-soft cursor-pointer"
            style={{ opacity: k.applies ? 1 : 0.55 }}
          >
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={k.enabled}
              disabled={!k.applies}
              onChange={(ev) => flip(k.kind, ev.target.checked)}
              aria-label={`${k.label} email`}
            />
            <span className="min-w-0">
              <span className="block text-[13.5px] text-ink">{k.label}</span>
              <span className="block text-[12.5px] text-ink-faint">
                {BLURB[k.kind]}
              </span>
            </span>
          </label>
        ))}
      </section>

      <section className="panel mb-[14px]">
        <div className="panel__head">
          <span className="panel-title">Sent to you</span>
          <a
            className="ml-auto text-[13px]"
            onClick={() => navigate("/account/activity/emails")}
          >
            Every email sent to you ›
          </a>
        </div>
        {data?.recent?.length > 0 ? (
          <div className="py-1">
            {data.recent.slice(0, 6).map((r) => (
              <a
                key={r.send_id}
                className="flex items-baseline gap-3 px-4 py-2 border-t border-line-soft text-[13.5px]"
                onClick={() => navigate(`/account/activity/e/${r.send_id}`)}
              >
                <span className="mono text-[12px] text-ink-faint shrink-0">
                  {day(r.sent_at)}
                </span>
                <span className="text-ink truncate">
                  {r.subject ?? r.label}
                </span>
                <span className="text-[12px] text-ink-faint shrink-0 ml-auto">
                  {r.label}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-faint">
            Nothing sent yet. Each email arrives here as it is sent, with its
            record.
          </p>
        )}
        <p className="footnote m-0 px-4 pb-[14px] pt-[10px]">
          Open one to see it as it was sent, or to report a problem with it.
          Sign-in codes are service mail and are not listed.
        </p>
      </section>
    </>
  );
}
