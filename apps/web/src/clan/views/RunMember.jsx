import {
  Chips,
  Empty,
  ErrorState,
  Icon,
  Link,
  Panel,
  Row,
  Rows,
  Stat,
  Stats,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { useManage, useMemberHistory, useMemberNotes } from "../lib/queries.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { RoleChip } from "../components/RoleChip.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { CLAN, playerInClanPath } from "../lib/base.js";
import { ROLE } from "../lib/words.js";
import {
  HISTORY_FILTERS,
  PART_WORDS,
  didTheirPart,
  gapLine,
  historyLine,
  kickHeld,
  median,
  quietDays,
} from "../lib/members.js";
import { BoardState, runMembersPath } from "./RunMembers.jsx";

/** A demotion's reason as a leader reads it; the stored value stays. */
const DEMOTION_WORDS = {
  abandoned: "slipping, missed the minimums",
  outranked: "another member takes the seat",
};

/** Why a member stands where they do, a sentence each: the engine's own
 *  reasons win; otherwise each moving part of the reading has its line. */
export function whyLines(m) {
  const lines = [];
  const r = m.removal ?? {};
  const days = r.days_idle == null ? null : Math.floor(r.days_idle);
  if (r.triage?.reason) lines.push(`Removal: ${r.triage.reason}`);
  else if (m.judgment?.removal === "held")
    lines.push("Removal: too little to go on, activity unknown.");
  else if (days !== null && r.state && r.state !== "none")
    lines.push(
      `Removal: ${days} ${noun(days, "day")} without a battle${r.shielded ? `, ${r.shielded}` : ""}.`,
    );
  if (m.promotion?.state === "eligible")
    lines.push(`Elder: ready, on ${m.promotion.weeks} weekly reviews.`);
  else if (m.promotion?.state === "building")
    lines.push(`Elder: building, ${m.promotion.weeks} weekly reviews so far.`);
  if (m.demotion && m.demotion.state && m.demotion.state !== "none")
    lines.push(
      `Elder: ${DEMOTION_WORDS[m.demotion.reason] ?? "slipping"}, ${m.demotion.weeks} weekly reviews.`,
    );
  for (const line of m.judgment_reasons ?? []) lines.push(line);
  return lines;
}

const leaderRole = (role) => role === "leader" || role === "coLeader";

/** The kick clock under the last battle, in a few words. */
function kickClock(m, policy) {
  if (!policy?.removal) return "No kick clock in the rules";
  if (leaderRole(m.role)) return "Skipped by the rules";
  if (kickHeld(m)) return "No kick while their exception runs";
  const r = m.removal ?? {};
  if (!r.state || r.state === "none") return "Kick clock not running";
  const days = quietDays(m);
  // The member's own day: the engine adds any contribution grace to it.
  const day = r.removal_day ?? policy.removal_day;
  return day && days !== null
    ? `Kick clock: day ${days} of ${day}`
    : "Kick clock running";
}

/** The day of the last recorded battle. The kick clock's quiet days also
 *  count a join or a battle-count rise, so they never name a battle. */
function lastBattleValue(m, feedDayHeading) {
  const t = m.facts?.last_battle_time;
  return t ? feedDayHeading(t) : "None on record";
}

/** The four tiles and the reasons: where the member stands now. */
function Standing({ m, d }) {
  const { feedDayHeading } = useClock();
  const part = didTheirPart(m);
  const war = m.facts?.war;
  const donations = m.facts?.donations_average;
  const clanMedian = median(d.board.map((x) => x.facts?.donations_average));
  const ranked = d.policy?.ranks_elder && m.standing?.rank;
  const lines = whyLines(m);
  return (
    <>
      <Stats label="Where they stand" className="kit-stats--quad">
        <Stat
          label="Last battle"
          value={lastBattleValue(m, feedDayHeading)}
          small
          note={kickClock(m, d.policy)}
        />
        <Stat
          label="Did their part?"
          value={part === true ? "Yes" : part === false ? "No" : "Not sure"}
          small
          tone={part === false ? "warn" : undefined}
          note={
            war && war.decks_asked
              ? `${war.decks_played} of ${war.decks_asked} war decks, last ${war.weeks} ${noun(war.weeks, "race")}`
              : PART_WORDS[String(part)]
          }
        />
        <Stat
          label="Elder rank"
          value={ranked ? m.standing.rank : "—"}
          of={
            ranked && d.band?.ranked_population
              ? `of ${d.band.ranked_population}`
              : undefined
          }
          note={
            !d.policy?.ranks_elder
              ? "The rules don't rank Elder"
              : leaderRole(m.role)
                ? "Skipped by the rules"
                : ranked
                  ? null
                  : "Not ranked yet"
          }
        />
        <Stat
          label="Donations"
          value={Number.isFinite(donations) ? Math.round(donations) : "—"}
          of={Number.isFinite(donations) ? "a week" : undefined}
          note={
            Number.isFinite(clanMedian)
              ? `Clan median ${Math.round(clanMedian)}`
              : null
          }
        />
      </Stats>
      {m.phrase ? (
        <p className="page-head__note mb-0 mt-3">{m.phrase}</p>
      ) : null}
      {lines.length ? (
        <ul className="clan-member__why">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The member's history in the clan, newest first, with its own filters
 *  and its own error: a failed read here leaves the rest of the page. */
function History({ clan, player, history }) {
  const { whenDay, calendar } = useClock();
  const [filter, setFilter] = useState("all");
  const { state, load } = history;
  if (state.error === "not_a_member")
    return (
      <Empty title="Nothing on record">
        Elixir has no record of this player in {clan.name ?? "this clan"}.
      </Empty>
    );
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>The history is for the clan&rsquo;s leader and co-leaders.</span>
      </div>
    );
  if (state.error)
    return (
      <ErrorState
        title="The history could not be read just now"
        onRetry={() => load()}
        busy={state.loading}
      >
        Elixir was slow or did not answer. The rest of this page still works.
        Try again in a moment.
      </ErrorState>
    );
  const d = state.data;
  if (!d) return <p className="page__lede m-0 p-4">Reading the history…</p>;
  const clanName = d.clan_name ?? clan.name ?? "the clan";
  const shown = d.entries.filter(
    (e) => filter === "all" || e.groups?.includes(filter),
  );
  const gaps = gapLine(d.gaps);
  return (
    <div className="grid gap-3">
      <div className="px-4">
        <Chips
          label="Show in the history"
          value={filter}
          onChange={setFilter}
          options={HISTORY_FILTERS.map(([key, label]) => ({
            key,
            label,
            count:
              key === "all"
                ? d.entries.length
                : d.entries.filter((e) => e.groups?.includes(key)).length,
          }))}
        />
      </div>
      {shown.length ? (
        <Rows aria-label={`History in ${clanName}`} role="list">
          {shown.map((e) => {
            const line = historyLine(e, { clanName, calendar, self: player });
            return (
              <div role="listitem" key={e.id}>
                <Row
                  title={line.title}
                  detail={line.detail ?? undefined}
                  right={
                    <span className="page-head__note">{whenDay(e.at)}</span>
                  }
                />
              </div>
            );
          })}
        </Rows>
      ) : (
        <Empty title="Nothing here yet">
          Nothing of this kind is on record for this member.
        </Empty>
      )}
      {gaps ? <p className="page-head__note m-0 px-4 pb-4">{gaps}</p> : null}
    </div>
  );
}

/**
 * Run › Members › one member, for the leader and co-leaders: who they are,
 * where they stand, their notes and exceptions, and their history in the
 * clan. Each panel reads on its own and fails on its own.
 */
export function RunMember({ clan, who, player, navigate }) {
  const board = useManage(clan.clan_tag, true);
  const history = useMemberHistory(clan.clan_tag, player, true);
  // A note added or removed on this page shows in the history too.
  const notesAt = useMemberNotes(clan.clan_tag, player).dataUpdatedAt;
  const seen = useRef(null);
  const reloadHistory = history.load;
  useEffect(() => {
    // The first read of the notes is not a change; a later one is.
    if (seen.current && notesAt !== seen.current) reloadHistory();
    seen.current = notesAt;
  }, [notesAt, reloadHistory]);

  if (board.state.signedOut || history.state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const d = board.state.data;
  const m = d?.board.find((x) => x.player_tag === player) ?? null;
  const h = history.state.data?.member ?? null;
  const name = m?.name ?? h?.name ?? player;
  const role = m?.role ?? h?.role ?? null;
  const days = h?.days_in_clan ?? m?.facts?.observed_days ?? null;
  const tenureKnown = h ? h.tenure_known : m?.facts?.tenure_known;
  const clanName = history.state.data?.clan_name ?? clan.name ?? "the clan";
  const inClan = h ? h.in_clan : Boolean(m);
  const facts = [
    player,
    inClan && days !== null
      ? `in ${clanName} ${tenureKnown === false ? "at least " : ""}${days} ${noun(days, "day")}`
      : h && !h.in_clan
        ? `no longer in ${clanName}`
        : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-4 clan-member">
      <Link
        to={runMembersPath(clan.clan_tag)}
        navigate={navigate}
        className="clan-member__back"
      >
        <Icon name="chevron-left" size={16} />
        Members
      </Link>
      <PageHead
        title={name}
        lede={facts.join(" · ")}
        fresh={
          <Link
            to={playerInClanPath(player)}
            navigate={navigate}
            className="btn btn--sm"
          >
            Player page
          </Link>
        }
      >
        {role ? <RoleChip role={role} label={ROLE[role] ?? role} /> : null}
      </PageHead>
      <Panel title="Now" pad>
        {!d ? (
          <BoardState
            state={board.state}
            query={board.query}
            load={board.load}
            clan={clan}
            navigate={navigate}
            what="Where they stand"
          />
        ) : m ? (
          <Standing m={m} d={d} />
        ) : (
          <p className="page-head__note m-0">
            Not on the clan&rsquo;s board now: only members the rules read are
            on it.
          </p>
        )}
      </Panel>
      {m ? (
        <section aria-labelledby="member-sheet-title" className="grid gap-2">
          <h2 id="member-sheet-title" className="kit-panel__title m-0">
            Notes and exceptions
          </h2>
          <p className="page-head__note m-0">Both also show in the history.</p>
          <MemberSheet
            clanTag={clan.clan_tag}
            member={m}
            role={who.role}
            onChange={() => {
              board.load(true);
              history.load();
            }}
          />
        </section>
      ) : null}
      <Panel title={`History in ${clanName}`}>
        <History clan={clan} player={player} history={history} />
      </Panel>
    </div>
  );
}
