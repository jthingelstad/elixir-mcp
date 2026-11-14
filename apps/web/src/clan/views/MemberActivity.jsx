import {
  Disclosure,
  Link,
  useClock,
  MODE_LABEL,
  Tag,
  Panel,
  Table,
  noun,
  ErrorState,
} from "@elixir-mcp/ui";
import { useState } from "react";
import {
  useActions,
  useManage,
  useMemberActivity,
  useRoster,
  useStanding,
} from "../lib/queries.js";
import { clanPath } from "../lib/base.js";
import { leads } from "../lib/tabs.js";
import { ROLE, n, seasonWeek } from "../lib/words.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { ReportThis } from "../components/ReportThis.jsx";
import { statusChip } from "../components/YouHereCard.jsx";

const OUTCOME = { win: "win", loss: "loss", draw: "draw" };

/** The numbers the game's counter and Elixir's matched battles agree on, or
 *  null when no span can be compared. */
function matched(coverage) {
  const known = (coverage?.intervals ?? []).filter(
    (i) => i.expected_battles != null && i.captured_battles != null,
  );
  if (!known.length) return null;
  return {
    captured: known.reduce((k, i) => k + i.captured_battles, 0),
    expected: known.reduce((k, i) => k + i.expected_battles, 0),
  };
}

/** The leaders' block: another person's clock, and what waits on them. Below
 *  co-leader nobody sees it (Q1). */
function ActivityClock({ clan, playerTag, navigate, who }) {
  const { state, load } = useManage(clan.clan_tag, true);
  const actions = useActions(clan.clan_tag).state.data;
  const [open, setOpen] = useState(false);
  const m = state.data?.board?.find((x) => x.player_tag === playerTag);
  if (!m) return null;
  const r = m.removal ?? {};
  const days = r.days_idle == null ? null : Math.floor(r.days_idle);
  const removalDay = r.removal_day ?? null;
  const waiting = (actions?.open ?? []).find(
    (a) => a.player_tag === playerTag && Number.isInteger(a.number),
  );
  const to = waiting
    ? `${clanPath(clan.clan_tag)}/actions/${waiting.number}`
    : null;
  return (
    <Panel aria-labelledby="member-clock" className="mb-4">
      <div className="panel__head">
        <h3 id="member-clock" className="kit-panel__title grow">
          Activity clock, leaders only
        </h3>
      </div>
      <div className="panel__body grid gap-2">
        <p className="m-0">
          {days === null
            ? "Their activity could not be read just now."
            : `${days} ${noun(days, "day")} without a battle.${r.at_risk_days != null ? ` At risk at ${r.at_risk_days}${removalDay != null ? `, action at ${removalDay}` : ""}${r.grace_days ? `, with ${r.grace_days} grace ${noun(r.grace_days, "day")} today` : ", no grace days today"}.` : ""}`}
        </p>
        {waiting ? (
          <p className="m-0">Action #{waiting.number} waits on Today.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {to ? (
            <Link to={to} navigate={navigate} className="btn btn--sm">
              Open Action
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn--sm"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Notes and hold
          </button>
        </div>
        {open ? (
          <MemberSheet
            clanTag={clan.clan_tag}
            member={m}
            role={who?.role}
            onChange={() => load(true)}
          />
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Another member's record in this clan: who they are here, then the numbers
 * every member may read. Facts only; a dash where the record holds nothing,
 * and a gap is unknown, never a claim they did not play. Since 2026-11-12 it
 * is drawn on the player page's Clan tab (PlayerInClan.jsx); its old address
 * here redirects there.
 */
export function MemberActivity({
  clan,
  playerTag,
  navigate,
  rosterSearch = "",
  embedded = false,
}) {
  const { when } = useClock();
  const [pages, setPages] = useState([{ cursor: null, to: null }]);
  const current = pages.at(-1);
  const { state, load } = useMemberActivity(
    clan.clan_tag,
    playerTag,
    current.cursor,
    current.to,
  );
  const lead = leads(clan);
  const roster = useRoster(clan.clan_tag).state.data;
  const standing = useStanding(clan.clan_tag).data;
  const d = state.data;
  const stamp = (at) => (at ? when(at) : "—");
  const row = roster?.members?.find((m) => m.player_tag === playerTag);
  const standingRow = standing?.ok
    ? standing.data?.rows?.find((r) => r.player_tag === playerTag)
    : null;
  const chip = standingRow?.status ? statusChip(standingRow.status) : null;
  const back = (
    <Link
      to={
        `${clanPath(clan.clan_tag)}/members` +
        (rosterSearch ? `?${new URLSearchParams({ find: rosterSearch })}` : "")
      }
      navigate={navigate}
    >
      ‹ Back to Members
    </Link>
  );
  const name = d?.name ?? row?.name;
  // On the player page (2026-11-12) the page's own head names them: only
  // who they are here is said.
  const head = embedded ? (
    row ? (
      <p className="page__lede mt-0">
        {`${ROLE[row.role] ?? row.role} in ${clan.name ?? "this clan"}${lead && row.joined_observed_at ? ` · here since ${when(row.joined_observed_at)}` : ""}`}
      </p>
    ) : null
  ) : (
    <>
      {back}
      <div className="page-head mt-3">
        <h2 className="page__title">{name ?? <Tag tag={playerTag} />}</h2>
        <span className="page-head__note">
          {row
            ? `${ROLE[row.role] ?? row.role} · ${n(row.trophies)} trophies${lead && row.joined_observed_at ? ` · in ${clan.name ?? "this clan"} since ${when(row.joined_observed_at)}` : ""}`
            : null}
        </span>
      </div>
    </>
  );
  if (!d)
    return (
      <>
        {head}
        {state.error === "not_current_member" ? (
          <div className="callout" role="note">
            <span>
              <b>This player is no longer on this clan&rsquo;s roster.</b> Their
              record stays in Stats; it is not read here.
            </span>
          </div>
        ) : state.forbidden || state.signedOut || state.error ? (
          <ErrorState
            title="This member’s numbers could not be read just now"
            onRetry={() => load()}
            busy={state.loading}
          >
            Check your clan access, or try again in a moment.
          </ErrorState>
        ) : (
          <p className="page__lede">Reading this member&rsquo;s numbers…</p>
        )}
      </>
    );
  const count = matched(d.coverage);
  return (
    <>
      {head}
      <dl className="clan-facts mb-4">
        <div>
          <dt className="label">Last battle in this clan</dt>
          <dd className="m-0">{stamp(d.last_recorded_battle_in_clan)}</dd>
        </div>
        <div>
          <dt className="label">Last seen in game</dt>
          <dd className="m-0">
            {stamp(d.last_seen_in_game)}
            <span className="block page-head__note">
              The game&rsquo;s own time, separate from battles.
            </span>
          </dd>
        </div>
        <div>
          <dt className="label">Numbers as of</dt>
          <dd className="m-0">{stamp(d.as_of)}</dd>
        </div>
      </dl>
      {chip ? (
        <p className="mb-4 flex flex-wrap items-center gap-2">
          <span className={`chip ${chip[1]}`}>{chip[0]}</span>
          {standingRow.evidence ? (
            <span className="text-ink-dim">{standingRow.evidence}</span>
          ) : null}
        </p>
      ) : null}
      {lead ? (
        <ActivityClock
          clan={clan}
          playerTag={playerTag}
          navigate={navigate}
          who={{ role: clan.role }}
        />
      ) : null}
      <Panel title="War decks, race by race" titleAs="h3" className="mb-4">
        {d.war_weeks.length ? (
          <Table
            columns={[
              {
                head: "Race",
                cell: (w) => (
                  <>
                    {seasonWeek(w)}
                    {w.open ? " so far" : ""}
                    {w.attribution_unknown ? " · not known" : ""}
                    {w.is_colosseum
                      ? " · Colosseum"
                      : w.finished_early
                        ? " · clan finished early"
                        : ""}
                  </>
                ),
              },
              { head: "Decks", num: true, cell: (w) => n(w.decks) },
              { head: "Points", num: true, cell: (w) => n(w.points) },
            ]}
            rows={d.war_weeks}
            rowKey={(w) => `${w.season_id}-${w.section_index}`}
          />
        ) : (
          <p className="panel__body m-0 text-ink-dim">
            No race in this read for this member.
          </p>
        )}
      </Panel>
      <Panel title="Week by week" titleAs="h3" className="mb-4">
        <Table
          columns={[
            {
              head: "Week of",
              cell: (w) => (
                <>
                  {when(w.from)}
                  {w.partial ? " · so far" : ""}
                </>
              ),
            },
            { head: "Battles", num: true, cell: (w) => n(w.battles) },
            { head: "Ranked", num: true, cell: (w) => n(w.ranked_battles) },
            { head: "Donations", num: true, cell: (w) => n(w.donations) },
          ]}
          rows={d.weeks}
          rowKey={(w) => w.iso_week}
        />
      </Panel>
      <div className="grid gap-3 mb-4">
        <Disclosure title="Recent battles in this clan">
          {d.battles.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {d.battles.map((b) => (
                <li
                  key={b.battle_id}
                  className="flex justify-between gap-3 text-[13.5px]"
                >
                  <span>
                    {b.url ? (
                      <a href={b.url}>
                        {MODE_LABEL[b.mode_group] ??
                          b.game_mode?.name ??
                          "Battle"}
                      </a>
                    ) : (
                      (MODE_LABEL[b.mode_group] ??
                      b.game_mode?.name ??
                      "Battle")
                    )}
                    {b.outcome ? ` · ${OUTCOME[b.outcome] ?? b.outcome}` : ""}
                    {b.crowns != null && b.opponent_crowns != null
                      ? ` · ${b.crowns} to ${b.opponent_crowns}`
                      : ""}
                  </span>
                  <span className="shrink-0 text-ink-faint">
                    {stamp(b.battle_time)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-ink-dim">
              No battle in this clan on this page.{" "}
              {d.next_cursor ? "There are older ones to read." : ""}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {pages.length > 1 ? (
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => setPages((p) => p.slice(0, -1))}
              >
                Newer battles
              </button>
            ) : null}
            {d.next_cursor ? (
              <button
                className="btn btn--sm"
                type="button"
                onClick={() =>
                  setPages((p) => [
                    ...p,
                    { cursor: d.next_cursor, to: d.window.to },
                  ])
                }
              >
                Older battles
              </button>
            ) : null}
          </div>
        </Disclosure>
        <Disclosure title="How these are counted">
          <p className="m-0 text-[13.5px]">
            Battles name this clan and fall in this member&rsquo;s current time
            here. A count from the week they joined stays unknown, shown as a
            dash.
          </p>
          <p className="mt-2 mb-0 text-[13.5px]">
            A gap is unknown. No battle here does not prove no play
            {count
              ? `: Elixir last matched ${n(count.captured)} of the ${n(count.expected)} battles the game's counter added.`
              : "."}
          </p>
        </Disclosure>
      </div>
      <ReportThis
        about={`${name ?? playerTag} in ${clan.name ?? clan.clan_tag}. Say what reads wrong.`}
        refs={[
          { kind: "clan", ref: clan.clan_tag },
          { kind: "player", ref: playerTag },
        ]}
        context={{ page: "member" }}
      />
    </>
  );
}
