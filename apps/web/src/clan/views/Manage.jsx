import {
  Empty,
  Fresh,
  Panel,
  Tag,
  ago,
  noun,
  useClock,
  Link,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useManage } from "../lib/queries.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { RoleChip } from "../components/RoleChip.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { CLAN, clanPath, playerInClanPath } from "../lib/base.js";
import { ROLE } from "../lib/words.js";

/** A demotion's reason as a leader reads it; the stored value stays. */
const DEMOTION_WORDS = {
  abandoned: "slipping, missed the minimums",
  outranked: "another member takes the seat",
};

const SECTIONS = [
  [
    "actionable",
    "Action now",
    "The policy has raised an action for these members.",
  ],
  [
    "building",
    "Getting close",
    "Up or down: nearing an action, not there yet. Good news sits here too.",
  ],
  [
    "held",
    "Too little to go on",
    "Elixir waits rather than guessing. No action can be raised until the numbers are known.",
  ],
];

/** Why a member is in their section, in a sentence. Reasons the engine gives
 *  win; otherwise each moving part of the reading has its line. */
function whyLines(m) {
  const lines = [];
  const r = m.removal ?? {};
  const days = r.days_idle == null ? null : Math.floor(r.days_idle);
  if (r.triage?.reason) lines.push(`Removal: ${r.triage.reason}`);
  else if (m.judgment.removal === "held")
    lines.push("Removal: too little to go on, activity unknown.");
  else if (days !== null && r.state && r.state !== "none")
    lines.push(
      `Removal: ${days} ${noun(days, "day")} without a battle${r.shielded ? `, ${r.shielded}` : ""}.`,
    );
  if (m.promotion?.state === "eligible")
    lines.push(`Elder: ready, on ${m.promotion.weeks} weekly reviews.`);
  else if (m.promotion?.state === "building")
    lines.push(`Elder: building, ${m.promotion.weeks} weekly reviews so far.`);
  if (m.demotion && m.demotion.state !== "none")
    lines.push(
      `Elder: ${DEMOTION_WORDS[m.demotion.reason] ?? "slipping"}, ${m.demotion.weeks} weekly reviews.`,
    );
  for (const line of m.judgment_reasons ?? []) lines.push(line);
  return lines;
}

/** One member, as a row a phone can read: name, role, why they are here and
 *  the evidence; the row opens their notes and hold. */
function MemberRow({ m, who, open, setOpen, sheet, navigate, action }) {
  const { calendar } = useClock();
  const page = playerInClanPath(m.player_tag);
  const expanded = open === m.player_tag;
  return (
    <li
      className="clan-row clan-row--stack"
      data-you={m.player_tag === who.player_tag ? "true" : undefined}
    >
      <div className="clan-row__line">
        <span className="clan-row__main">
          <span className="clan-row__title">
            <Link to={page} navigate={navigate}>
              {m.name ?? <Tag tag={m.player_tag} />}
            </Link>{" "}
            <RoleChip role={m.role} label={ROLE[m.role] ?? m.role} />
            {m.hold?.active !== false && m.hold ? (
              <span className="chip chip--info ml-1.5">
                {m.hold.kind === "away" ? "away" : "hold"}
                {m.hold.until ? `, ${calendar(m.hold.until)}` : ""}
              </span>
            ) : null}
          </span>
          {whyLines(m).map((line) => (
            <span key={line} className="clan-row__why">
              {line}
            </span>
          ))}
          <span className="clan-row__meta">
            {m.phrase || "Nothing recorded yet"}
          </span>
        </span>
        <span className="shrink-0">
          <button
            type="button"
            className="btn btn--sm"
            aria-expanded={expanded}
            onClick={() => setOpen(expanded ? null : m.player_tag)}
          >
            Notes and hold
          </button>
        </span>
      </div>
      {action}
      {expanded ? sheet(m) : null}
    </li>
  );
}

/** Review: the leaders' working view of the clan, leader and co-leader only
 *  (the API refuses everyone else): who is near an action, up or down, and why.
 *  Never a score or a rank. */
export function Review({ clan, navigate, who }) {
  const { whenDay } = useClock();
  const [open, setOpen] = useState(null); // member sheet
  const { state, load, query } = useManage(clan.clan_tag, true);

  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const head = (
    <PageHead
      title="Review"
      fresh={
        state.data ? (
          <Fresh
            label="as of"
            seconds={state.data.freshness_seconds}
            ts={state.data.as_of}
          />
        ) : null
      }
    />
  );
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Review is for the leader and co-leaders.</span>
        </div>
      </>
    );
  if (state.error === "too_few_members")
    return (
      <>
        {head}
        <Empty
          title={`Clan management starts at ${query.data?.data?.min_members ?? 10} members`}
        >
          Clan management is paused below {query.data?.data?.min_members ?? 10}{" "}
          members, so Review waits.
        </Empty>
      </>
    );
  if (state.error === "no_policy") {
    const to = `${clanPath(clan.clan_tag)}/run/about`;
    return (
      <>
        {head}
        <Empty
          title="No policy yet"
          action={
            <Link to={to} navigate={navigate} className="btn btn--primary">
              Set up the policy
            </Link>
          }
        >
          Nothing in clan management runs until a leader or co-leader sets this
          clan&rsquo;s policy.
        </Empty>
      </>
    );
  }
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet, so there is nothing to read."
              : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!state.data)
    return (
      <>
        {head}
        <p className="page__lede">Reading the record…</p>
      </>
    );
  const d = state.data;
  const sheet = (m) => (
    <MemberSheet
      clanTag={clan.clan_tag}
      member={m}
      role={who.role}
      onChange={() => load(true)}
    />
  );
  const count = (bucket) => d.board.filter((m) => m.bucket === bucket).length;
  const heldKinds = (kind) =>
    d.board.filter((m) => ["held", "unknown"].includes(m.judgment[kind]))
      .length;
  const removal = (status) =>
    d.board.filter((m) => m.removal.triage?.status === status).length;
  const props = { who, clan, open, setOpen, sheet, navigate };
  return (
    <>
      {head}
      <div className="grid gap-1 mb-4">
        <BandLine band={d.band} roster={d.roster} />
        {d.policy?.ranks_elder ? (
          <p className="page-head__note m-0">
            Too little to decide Elder: promotion {heldKinds("promotion")},
            demotion {heldKinds("demotion")}. One person can count in both.
          </p>
        ) : null}
        {d.policy?.removal ? (
          <p className="page-head__note m-0">
            Removal: {removal("protected")} protected by their role, a hold or
            the wait after a decision, {removal("not_candidate")} not close,{" "}
            {removal("evidence_held")} with too little to go on,{" "}
            {removal("eligible")} past the removal day.
          </p>
        ) : null}
        <p className="page-head__note m-0">
          Last read {ago(d.evaluated_at)} under policy v{d.policy_version}
          {d.boundaries.length
            ? `, over ${d.boundaries.length} weekly reviews (last ${whenDay(d.boundaries.at(-1))})`
            : ", with no closed weekly review on record yet"}
          .{" "}
          <button
            type="button"
            className="btn--text"
            onClick={() => load(true)}
            disabled={state.loading}
          >
            {state.loading ? "Reading…" : "Read again"}
          </button>
        </p>
      </div>
      <nav aria-label="Review sections" className="mb-4 flex flex-wrap gap-2">
        {[...SECTIONS, ["clear", "Clear"]].map(([bucket, label]) =>
          count(bucket) ? (
            <a key={bucket} className="chip" href={`#board-${bucket}`}>
              {label} · {count(bucket)}
            </a>
          ) : null,
        )}
      </nav>
      {SECTIONS.map(([bucket, label, says]) => {
        const rows = d.board.filter((m) => m.bucket === bucket);
        if (!rows.length) return null;
        return (
          <Panel
            key={bucket}
            id={`board-${bucket}`}
            aria-labelledby={`board-${bucket}-title`}
            className="mb-4 scroll-mt-4 overflow-hidden"
          >
            <div className="panel__head flex-wrap gap-2">
              <h3 id={`board-${bucket}-title`} className="kit-panel__title">
                {label}
              </h3>
              <span className="chip">
                {rows.length}
                {bucket === "actionable" ? ", also in the Feed" : ""}
              </span>
              <span className="grow text-[12.5px] font-normal text-ink-faint">
                {says}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {rows.map((m) => (
                <MemberRow key={m.player_tag} m={m} {...props} />
              ))}
            </ul>
          </Panel>
        );
      })}
      {count("clear") ? (
        <Panel id="board-clear" className="mb-4 scroll-mt-4">
          <div className="panel__head">
            <h3 className="kit-panel__title">
              Clear, {count("clear")} {noun(count("clear"), "member")}
            </h3>
          </div>
          <p className="panel__body m-0 text-ink-dim">
            Nobody here is near an action. Open a member from the Roster for
            their numbers.
          </p>
        </Panel>
      ) : null}
    </>
  );
}

function BandLine({ band, roster }) {
  if (!band)
    return roster ? (
      <p className="page-head__note m-0">
        {roster.size} members, {roster.open_slots} open. Elders are chosen by
        the leaders.
      </p>
    ) : null;
  return (
    <p className="page-head__note m-0">
      {band.roster_size} members, {band.open_slots} open. {band.current_elders}{" "}
      Elders; the policy keeps {band.floor} to {band.ceil}, aiming for{" "}
      {band.target}.
    </p>
  );
}
