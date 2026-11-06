import {
  Empty,
  Icon,
  Link,
  Panel,
  Table,
  Tag,
  ZoneProvider,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useRoster } from "../lib/queries.js";
import { ELIXIR_LINKS } from "../lib/links.js";
import {
  InviteLeaders,
  SpreadWord,
  spreadState,
} from "../components/SpreadWord.jsx";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { CLAN, clanPath, memberPath } from "../lib/base.js";
import { ordinal, seasonWeek } from "../lib/words.js";
import { leads } from "../lib/tabs.js";

const ROLE_ORDER = ["leader", "coLeader", "elder", "member"];
const ROLE_COUNT = {
  leader: ["leader", "leaders"],
  coLeader: ["co-leader", "co-leaders"],
  elder: ["elder", "elders"],
};
const TYPE = {
  open: "Open to anyone",
  inviteOnly: "Invite only",
  closed: "Closed",
};
/** Above this many members the roster opens on the first SHOWN rows and
 *  offers the rest, as the canvas does. */
const LONG = 30;
const SHOWN = 25;

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());

/** The roster, grouped by role, your row marked. Every column is what the
 *  tool answered; a null is shown as a dash, never as zero. `limit` shows
 *  the first rows in role order and offers the rest. */
export function RosterTable({
  members,
  limit = null,
  onMore,
  clanTag,
  navigate,
  search = "",
}) {
  const { when } = useClock();
  const shown = limit === null ? members : members.slice(0, limit);
  const hidden = members.slice(shown.length);
  const groups = [...ROLE_ORDER, ...new Set(members.map((m) => m.role))]
    .filter((r, i, a) => a.indexOf(r) === i)
    .map((role) => [
      role,
      shown.filter((m) => m.role === role),
      members.filter((m) => m.role === role).length,
    ])
    .filter(([, rows]) => rows.length > 0);
  const floor = hidden
    .map((m) => m.trophies)
    .filter((t) => t !== null && t !== undefined);
  return (
    <div className="clan-rows roster-table">
      <Table
        groups={groups.map(([role, rows]) => ({ key: role, rows }))}
        rowKey={(m) => m.player_tag}
        rowProps={(m) => ({
          "data-you": m.you ? "true" : undefined,
          className: m.you ? "bg-panel-raised" : undefined,
        })}
        columns={[
          {
            head: "Member",
            cellProps: (m) => ({ title: m.player_tag }),
            cell: (m) => (
              <>
                <span className="inline-flex items-center gap-2">
                  <span
                    className={
                      m.you ? "font-semibold text-ink" : "font-medium text-ink"
                    }
                  >
                    {clanTag ? (
                      <Link
                        to={
                          memberPath(clanTag, m.player_tag) +
                          (search
                            ? `?${new URLSearchParams({ find: search })}`
                            : "")
                        }
                        navigate={navigate}
                      >
                        {m.name ?? <Tag tag={m.player_tag} />}
                      </Link>
                    ) : (
                      (m.name ?? <Tag tag={m.player_tag} />)
                    )}
                  </span>
                  {m.you ? (
                    <span className="chip chip--info px-2 py-0 text-[11px]">
                      you
                    </span>
                  ) : null}
                </span>
                <span className="roster-table__line">
                  <span>
                    {m.role_label ?? m.role} · {num(m.donations_this_week)}{" "}
                    donated
                  </span>
                  {m.last_recorded_battle ? (
                    <span>Battle {when(m.last_recorded_battle)}</span>
                  ) : null}
                </span>
              </>
            ),
          },
          {
            head: "Role",
            className: "roster-table__wide",
            cellProps: () => ({ "data-label": "Role" }),
            cell: (m) => (
              <span className="text-ink-dim">{m.role_label ?? m.role}</span>
            ),
          },
          {
            head: "Trophies",
            num: true,
            className: "roster-table__trophies",
            cellProps: () => ({ "data-label": "Trophies" }),
            cell: (m) => num(m.trophies),
          },
          {
            head: "Donations this week",
            num: true,
            className: "roster-table__wide",
            cellProps: () => ({ "data-label": "Donated this week" }),
            cell: (m) => num(m.donations_this_week),
          },
          {
            head: "Last seen in game",
            className: "roster-table__wide",
            cellProps: () => ({ "data-label": "Last seen" }),
            cell: (m) =>
              m.last_seen_in_game ? (
                when(m.last_seen_in_game)
              ) : (
                <span className="nil">—</span>
              ),
          },
          {
            // A date, never a day count: the count is a member's own, and leaders'
            // on Review (Q2).
            head: "Last battle",
            className: "roster-table__wide",
            cellProps: () => ({ "data-label": "Last battle" }),
            cell: (m) =>
              m.last_recorded_battle ? (
                when(m.last_recorded_battle)
              ) : (
                <span className="nil">—</span>
              ),
          },
        ]}
        foot={
          hidden.length ? (
            <button
              type="button"
              className="btn btn--sm btn--quiet"
              onClick={onMore}
            >
              <Icon name="chevron-down" size={14} />
              {hidden.length} more {hidden.length === 1 ? "member" : "members"}
              {floor.length
                ? `, down to ${num(Math.min(...floor))} trophies`
                : ""}
            </button>
          ) : null
        }
      />
    </div>
  );
}

function ClanHeader({ roster }) {
  return (
    <PageHead
      title="Roster"
      lede={
        roster
          ? [
              TYPE[roster.type],
              roster.required_trophies != null
                ? `${num(roster.required_trophies)} trophies to join`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null
      }
    />
  );
}

/** The clan's own figures as tiles: what the roster read returned. */
function ClanTiles({ roster }) {
  const counts = Object.entries(ROLE_COUNT)
    .map(([role, [one, many]]) => {
      const k = roster.role_counts?.[role] ?? 0;
      return k ? `${k} ${k === 1 ? one : many}` : null;
    })
    .filter(Boolean);
  const race = (roster.comings ?? []).find(
    (e) => e.type === "week_resolved" && e.rank !== null,
  );
  const change =
    race && typeof race.trophy_change === "number"
      ? `, ${race.trophy_change > 0 ? "+" : ""}${num(race.trophy_change)}`
      : "";
  return (
    <Tiles label="The clan in numbers">
      <Tile
        label="Members"
        value={num(roster.member_count)}
        hint={counts.length ? counts.join(", ") : undefined}
      />
      {roster.clan_war_trophies !== null &&
      roster.clan_war_trophies !== undefined ? (
        <Tile
          label="Clan war trophies"
          value={num(roster.clan_war_trophies)}
          hint={
            race
              ? `${ordinal(race.rank)} in ${seasonWeek(race)}${change}`
              : undefined
          }
        />
      ) : null}
      {roster.donations_per_week !== null &&
      roster.donations_per_week !== undefined ? (
        <Tile
          label="Donations a week"
          value={num(roster.donations_per_week)}
          hint="From the game's clan card"
        />
      ) : null}
    </Tiles>
  );
}

const RETURN_SLACK_MS = 36 * 3600_000;
const COMING = {
  member_joined: ["user-round", "text-ok"],
  member_left: ["log-out", "text-bad"],
  week_resolved: ["award", "text-accent-bright"],
};

/** Who joined, who departed and how the clan's races finished, newest
 *  first, from the roster's own events. A departure is "departed",
 *  never a kick or a leave. */
function Comings({ roster, clan, history, navigate }) {
  const { when } = useClock();
  const base = clanPath(clan.clan_tag);
  // Decided is the leaders'; everyone else reads the same week by week.
  const more = history ? `${base}/today/decided` : `${base}/season`;
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const back = new Map(
    (roster.members ?? [])
      .filter((m) => m.rejoined_observed_at)
      .map((m) => [m.player_tag, m.rejoined_observed_at]),
  );
  // A join is a return when the member is on the roster with an earlier
  // stint and this join is the one that began the current stint.
  const cameBack = (e) =>
    back.has(e.player_tag) &&
    Math.abs(Date.parse(e.at) - Date.parse(back.get(e.player_tag))) <
      RETURN_SLACK_MS;
  const line = (e) => {
    const who = (
      <b className="text-ink">{e.name ?? <Tag tag={e.player_tag} />}</b>
    );
    if (e.type === "member_joined")
      return cameBack(e) ? <>{who} came back</> : <>{who} joined</>;
    if (e.type === "member_left") return <>{who} departed</>;
    return `Finished ${ordinal(e.rank)}${e.is_colosseum ? " in the Colosseum" : ""}, ${seasonWeek(e)}${e.fame !== null ? `, with ${num(e.fame)} fame` : ""}`;
  };
  const rows = (roster.comings ?? []).filter(
    (e) => e.type !== "week_resolved" || e.rank !== null,
  );
  return (
    <Panel aria-labelledby="clan-comings">
      <div className="panel__head">
        <h2 id="clan-comings" className="m-0 grow text-[14px] font-semibold">
          Comings and goings
        </h2>
        <a className="text-[13px] font-normal" href={more} onClick={go(more)}>
          {history ? "Who came and went, on Today" : "Open Season"}
        </a>
      </div>
      <div className="px-4 py-1">
        {rows.length ? (
          rows.map((e, i) => {
            const [icon, tone] = COMING[e.type];
            return (
              <div
                key={`${e.type}-${e.at}-${e.player_tag ?? i}`}
                className="flex items-center gap-3 py-2.5 border-b border-line-row last:border-b-0"
              >
                <span className={`shrink-0 ${tone}`} aria-hidden="true">
                  <Icon name={icon} size={16} />
                </span>
                <span className="grow min-w-0 text-[13.5px] text-ink-body">
                  {line(e)}
                </span>
                <span className="shrink-0 text-[12.5px] text-ink-faint">
                  {when(e.at)}
                </span>
              </div>
            );
          })
        ) : (
          <p className="page-head__note my-2.5">
            Nobody has joined or departed since Elixir began recording the
            roster
            {roster.events_recorded_since
              ? ` (${when(roster.events_recorded_since)})`
              : ""}
            .
          </p>
        )}
      </div>
    </Panel>
  );
}

/** The roster. Reads /api/roster once per mount; the API caches it per session
 *  for a few minutes, and "Check again" is rate-limited there. `search` is the
 *  address's own (`/members?find=`), which Members' row writes. */
export function Clan({ me, clan, navigate, search = "", fromRun = false }) {
  const tag = clan.clan_tag;
  const gated = useRoster(tag);
  const state = { ...gated.state, roster: gated.state.data };
  const load = gated.load;
  const [all, setAll] = useState(false);
  const find = search;

  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }

  const roster = state.roster;
  const spread = roster ? spreadState({ me, clan, roster }) : null;
  const q = find.trim().toLowerCase();
  const members = roster?.members ?? [];
  const found = q
    ? members.filter(
        (m) =>
          String(m.name ?? "")
            .toLowerCase()
            .includes(q) || m.player_tag.toLowerCase().includes(q),
      )
    : members;
  const limit = !q && !all && members.length > LONG ? SHOWN : null;
  const policy = me.policy ?? null;
  const history = leads(clan) && (policy?.active ?? policy?.set === true);

  return (
    <ZoneProvider zone={roster?.meta?.timezone_applied ?? null}>
      <ClanHeader roster={roster} />
      {fromRun ? (
        <div className="mb-[22px]">
          <div className="callout callout--info mb-3" role="status">
            <span>
              Run is for the leader and co-leaders, and this clan has no policy
              to read yet.
            </span>
          </div>
          <InviteLeaders clan={clan} name={roster?.name} />
        </div>
      ) : null}
      {state.loading && !roster ? (
        <p className="page__lede">Reading the roster…</p>
      ) : state.error ? (
        <Empty
          title="Elixir did not answer the roster read"
          action={
            <button type="button" className="btn" onClick={() => load()}>
              Try again
            </button>
          }
        >
          Nothing is stored here to fall back on; try again in a minute.
        </Empty>
      ) : roster?.not_recorded ? (
        <Empty
          title={
            <>
              Elixir is not recording{" "}
              {clan.name ?? <Tag tag={roster.clan_tag} />} yet
            </>
          }
          action={
            <Link className="btn btn--primary" to={ELIXIR_LINKS.tracking}>
              Start tracking {clan.name ?? roster.clan_tag}
            </Link>
          }
        >
          Your player is in this clan, but the clan itself is not on
          Elixir&rsquo;s record, so there is no roster to read. Add it in
          Settings, and the roster arrives with the first read.
        </Empty>
      ) : roster ? (
        <>
          <ClanTiles roster={roster} />
          {!fromRun && spread && spread !== "active" ? (
            <div className="mb-[22px]">
              <SpreadWord
                me={me}
                clan={clan}
                roster={roster}
                navigate={navigate}
              />
            </div>
          ) : null}
          <div className="grid gap-4 items-start">
            <Panel className="min-w-0" aria-labelledby="clan-roster">
              <h3 id="clan-roster" className="sr-only">
                Members
              </h3>
              <div className="px-1.5 pb-1.5">
                {members.length === 0 ? (
                  <Empty title="No members on the record">
                    Elixir knows the clan but has not carried a member for it
                    yet. That resolves on its next roster read.
                  </Empty>
                ) : q && found.length === 0 ? (
                  <p className="page-head__note px-3 py-4">
                    Nobody on the roster matches &ldquo;{find.trim()}&rdquo;.
                  </p>
                ) : (
                  <RosterTable
                    clanTag={clan.clan_tag}
                    search={find}
                    navigate={navigate}
                    members={found}
                    limit={limit}
                    onMore={() => setAll(true)}
                  />
                )}
              </div>
              <div className="panel__foot flex flex-wrap items-center gap-2">
                <span>
                  {roster.member_count} {noun(roster.member_count, "member")}
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => load(true)}
                  disabled={state.loading}
                >
                  {state.loading ? "Reading…" : "Check again"}
                </button>
              </div>
            </Panel>
            <Comings
              roster={roster}
              clan={clan}
              history={history}
              navigate={navigate}
            />
            {spread === "active" ? (
              <SpreadWord
                me={me}
                clan={clan}
                roster={roster}
                navigate={navigate}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </ZoneProvider>
  );
}
