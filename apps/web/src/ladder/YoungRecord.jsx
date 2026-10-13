import { useInitialTime } from "@elixir-mcp/ui";
import { Link, noun } from "@elixir-mcp/ui";
import { CONSOLE } from "../lib/console.js";
import { useMyClans } from "../lib/queries.js";
import { youngRecord } from "./ladder.js";

const STEPS = {
  verify: {
    text: "Verify your player: one battle proves it is yours, and Elixir Clan needs it before you can act in your game role.",
    action: "Verify your player",
    to: `${CONSOLE}/account/verify`,
  },
  clan: {
    text: "Your player is verified and your clan is recorded, so Elixir Clan can show your clan and what your game role can do there.",
    action: "Open Clan",
    to: "/clan",
  },
  follow: {
    text: "Track a friend's tag and mark them as a friend: their battles are recorded beside yours.",
    action: "Follow a friend",
    to: `${CONSOLE}/account/tracking#add-player-tag`,
  },
};

/**
 * One next step on the season home while the record is young (under
 * YOUNG_RECORD_DAYS, ladder.js youngRecord): how old the record is and
 * a link. Plain facts; nothing about play. Its clan read is the one
 * Bring your clanmates already makes (`/api/me/clans`, cached), and the
 * record's start is the summary's meta, so it adds no request.
 */
export function YoungRecord({ player, summary, className = "" }) {
  const [now] = useInitialTime();
  const clans = useMyClans();
  const clanTag = player.last_known_clan_tag ?? null;
  const clanRecorded = clans.data
    ? Boolean(
        clanTag &&
        (clans.data.clans ?? []).some(
          (c) => c.clan_tag === clanTag && c.recording_status === "active",
        ),
      )
    : clans.isError
      ? false
      : null;
  const young = youngRecord({
    activeSince: summary.data?.meta?.recording_active_since,
    now,
    verified: player.status === "verified",
    clanRecorded,
  });
  if (!young) return null;
  const step = STEPS[young.step];
  return (
    <section
      className={`panel ${className}`.trim()}
      aria-labelledby="ladder-young-record"
    >
      <div className="panel__head">
        <h2 id="ladder-young-record" className="ladder-panel-title">
          {young.days === 0
            ? "Your record is less than a day old"
            : `Your record is ${young.days} ${noun(young.days, "day")} old`}
        </h2>
      </div>
      <div className="panel__body grid gap-2.5">
        <p className="m-0 text-[13.5px] text-ink-body">{step.text}</p>
        <Link className="btn btn--sm justify-self-start" to={step.to}>
          {step.action} ›
        </Link>
      </div>
    </section>
  );
}
