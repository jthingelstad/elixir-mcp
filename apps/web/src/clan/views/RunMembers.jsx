import {
  Chips,
  Empty,
  ErrorState,
  Fresh,
  Link,
  Panel,
  Row,
  Rows,
  Stat,
  Stats,
  ago,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useManage } from "../lib/queries.js";
import { PageHead } from "../components/PageHead.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { ROLE } from "../lib/words.js";
import {
  MEMBER_FILTERS,
  PART_WORDS,
  byRank,
  didTheirPart,
  inFilter,
  quietDays,
  whyChips,
} from "../lib/members.js";

/** Run › Members' path, and one member's page under it. */
export const runMembersPath = (clanTag) => `${clanPath(clanTag)}/run/members`;
export const runMemberPath = (clanTag, playerTag) =>
  `${runMembersPath(clanTag)}/${String(playerTag).replace(/^#/, "")}`;

/** The states every read of the board shares: signed out goes to sign-in,
 *  and the rest draw in place, so the page around them still works. */
export function BoardState({ state, query, load, clan, navigate, what }) {
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Run is for the clan&rsquo;s leader and co-leaders.</span>
      </div>
    );
  if (state.error === "too_few_members")
    return (
      <Empty title={`Starts at ${query.data?.data?.min_members ?? 10} members`}>
        Clan management is paused below {query.data?.data?.min_members ?? 10}{" "}
        members, so {what} waits.
      </Empty>
    );
  if (state.error === "no_policy")
    return (
      <Empty
        title="No rules yet"
        action={
          <Link
            to={`${clanPath(clan.clan_tag)}/run/rules`}
            navigate={navigate}
            className="btn btn--primary"
          >
            Set up the rules
          </Link>
        }
      >
        Nothing here runs until a leader or co-leader sets how the clan runs.
      </Empty>
    );
  if (state.error)
    return (
      <ErrorState
        title={
          state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet"
            : `${what} could not be read just now`
        }
        onRetry={state.error === "clan_not_recorded" ? undefined : () => load()}
        busy={state.loading}
      >
        {state.error === "clan_not_recorded"
          ? "There is nothing to read until it does."
          : "Elixir was slow or did not answer. Try again in a moment."}
      </ErrorState>
    );
  return <p className="page__lede m-0">Reading the record…</p>;
}

/** The board's top tiles: Elder seats, who did their part, who is quiet. */
function Tiles({ d }) {
  const board = d.board;
  const elders = board.filter((m) => m.role === "elder").length;
  const known = board.filter((m) => didTheirPart(m) !== null);
  const did = board.filter((m) => didTheirPart(m) === true).length;
  const quiet = board.filter((m) => (quietDays(m) ?? 0) >= 4).length;
  const weeks = d.policy?.minimums_window_weeks;
  return (
    <Stats label="The clan now" className="kit-stats--quad">
      {d.band ? (
        <Stat
          label="Elder seats"
          value={d.band.current_elders}
          of={`of ${d.band.ceil}`}
          note="taken"
          tone={d.band.current_elders > d.band.ceil ? "warn" : undefined}
        />
      ) : (
        <Stat label="Elders" value={elders} note="chosen by the leaders" />
      )}
      <Stat
        label="Did their part"
        value={known.length ? did : "—"}
        of={known.length ? `of ${board.length}` : undefined}
        note={
          weeks
            ? `The rules' minimums, last ${weeks} ${noun(weeks, "week")}`
            : "The rules' minimums"
        }
      />
      <Stat label="Quiet 4+ days" value={quiet} note="no battle since" />
    </Stats>
  );
}

/** Review's summary lines, kept: the band, who is held, the removal clock. */
function Summary({ d, state, load }) {
  const { whenDay } = useClock();
  const heldKinds = (kind) =>
    d.board.filter((m) => ["held", "unknown"].includes(m.judgment?.[kind]))
      .length;
  const removal = (status) =>
    d.board.filter((m) => m.removal?.triage?.status === status).length;
  return (
    <div className="grid gap-1">
      {d.band ? (
        <p className="page-head__note m-0">
          {d.band.roster_size} members, {d.band.open_slots}{" "}
          {d.band.open_slots === 1 ? "spot" : "spots"} open. The rules keep{" "}
          {d.band.floor} to {d.band.ceil} Elders, aiming for {d.band.target}.
        </p>
      ) : d.roster ? (
        <p className="page-head__note m-0">
          {d.roster.size} members, {d.roster.open_slots}{" "}
          {d.roster.open_slots === 1 ? "spot" : "spots"} open. Elders are chosen
          by the leaders.
        </p>
      ) : null}
      {d.policy?.ranks_elder ? (
        <p className="page-head__note m-0">
          Too little to decide Elder: promotion {heldKinds("promotion")},
          demotion {heldKinds("demotion")}. One person can count in both.
        </p>
      ) : null}
      {d.policy?.removal ? (
        <p className="page-head__note m-0">
          Removal: {removal("protected")} protected by their role, a hold or the
          wait after a decision, {removal("not_candidate")} not close,{" "}
          {removal("evidence_held")} with too little to go on,{" "}
          {removal("eligible")} past the removal day.
        </p>
      ) : null}
      <p className="page-head__note m-0">
        Last read {ago(d.evaluated_at)} under rules v{d.policy_version}
        {d.boundaries?.length
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
  );
}

/** When a member last battled, in a word or a day. */
function lastBattle(m, whenDay) {
  const days = quietDays(m);
  if (days === 0) return "Battled today";
  if (days === 1) return "Battled yesterday";
  if (m.facts?.last_battle_time)
    return `Last battle ${whenDay(m.facts.last_battle_time)}`;
  return days === null ? "No battle on record" : `Quiet ${days} days`;
}

function MemberRow({ m, d, clan }) {
  const { whenDay, calendar } = useClock();
  const chips = whyChips(m, { policy: d.policy ?? {}, calendar });
  const part = didTheirPart(m);
  return (
    <Row
      href={runMemberPath(clan.clan_tag, m.player_tag)}
      title={m.name ?? m.player_tag}
      detail={
        <>
          <span>
            {[
              ROLE[m.role] ?? m.role,
              lastBattle(m, whenDay),
              PART_WORDS[String(part)],
            ].join(" · ")}
          </span>
          {chips.length ? (
            <span className="clan-members__why">
              {chips.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </span>
          ) : null}
          {(m.judgment_reasons ?? []).map((line) => (
            <span key={line} className="clan-members__reason">
              {line}
            </span>
          ))}
        </>
      }
      right={
        d.policy?.ranks_elder && m.standing?.rank ? (
          <span className="page-head__note">#{m.standing.rank}</span>
        ) : undefined
      }
    />
  );
}

/**
 * Run › Members: every member in one list, for the leader and co-leaders
 * (the API refuses everyone else). Filters by what each member needs, the
 * clan's tiles above, and each row opens the member's page. Review's
 * sections and summary are folded in here (2026-11-23).
 */
export function RunMembers({ clan, navigate }) {
  const { state, load, query } = useManage(clan.clan_tag, true);
  const [picked, setPicked] = useState(null);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const d = state.data;
  const head = (
    <PageHead
      title="Members"
      lede="Where everyone stands. Tap a member to see their history."
      fresh={
        d ? (
          <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
        ) : null
      }
    />
  );
  if (!d)
    return (
      <div className="grid gap-4">
        {head}
        <BoardState
          state={state}
          query={query}
          load={load}
          clan={clan}
          navigate={navigate}
          what="Members"
        />
      </div>
    );
  const waiting = new Set(
    (d.inbox ?? []).map((c) => c.player_tag).filter(Boolean),
  );
  const count = (key) =>
    d.board.filter((m) => inFilter(m, key, waiting)).length;
  const filter = picked ?? (count("needs") ? "needs" : "all");
  const rows = d.board.filter((m) => inFilter(m, filter, waiting)).sort(byRank);
  const label = MEMBER_FILTERS.find(([k]) => k === filter)?.[1];
  return (
    <div className="grid gap-4">
      {head}
      <Tiles d={d} />
      <Chips
        label="Show members"
        value={filter}
        onChange={setPicked}
        options={MEMBER_FILTERS.map(([key, text]) => ({
          key,
          label: text,
          count: count(key),
        }))}
      />
      <Panel
        title={
          filter === "all"
            ? d.policy?.ranks_elder
              ? "Everyone, sorted by Elder rank"
              : "Everyone"
            : `${label}, ${rows.length} ${noun(rows.length, "member")}`
        }
      >
        {rows.length ? (
          <Rows>
            {rows.map((m) => (
              <MemberRow key={m.player_tag} m={m} d={d} clan={clan} />
            ))}
          </Rows>
        ) : (
          <Empty title="Nobody here">Nobody is under {label} right now.</Empty>
        )}
      </Panel>
      <Summary d={d} state={state} load={load} />
    </div>
  );
}
