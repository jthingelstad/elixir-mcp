import {
  Fresh,
  Icon,
  Link,
  ZoneProvider,
  ago,
  useClock,
  noun,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useRoster } from "../lib/queries.js";
import { RoleChip } from "../components/RoleChip.jsx";
import { ELIXIR_LINKS } from "../lib/links.js";
import { SpreadWord, spreadState } from "../components/SpreadWord.jsx";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { CLAN, clanPath, memberPath } from "../lib/base.js";

const ROLE_ORDER = ["leader", "coLeader", "elder", "member"];
const GROUP = {
  leader: "Leader",
  coLeader: "Co-leaders",
  elder: "Elders",
  member: "Members",
};
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
const LEADERS = new Set(["leader", "coLeader"]);
/** Above this many members the roster opens on the first SHOWN rows and
 *  offers the rest, as the canvas does. */
const LONG = 30;
const SHOWN = 25;

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());
const ordinal = (k) => {
  const s = ["th", "st", "nd", "rd"];
  const v = k % 100;
  return `${k}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The roster, grouped by role, your row marked. Every column is what the
 *  tool answered; a null is shown as a dash, never as zero. `limit` shows
 *  the first rows in role order and offers the rest. */
export function RosterTable({
  members,
  now,
  limit = null,
  onMore,
  clanTag,
  navigate,
  search = "",
}) {
  // Captured once per mount; a clock read during render is unstable.
  const [mounted] = useState(() => Date.now());
  const at = now ?? mounted;
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
    <div tabIndex={0} className="table__scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th className="text-right">Trophies</th>
            <th className="text-right">Donations this week</th>
            <th>Last seen in game</th>
            <th>Last recorded battle</th>
          </tr>
        </thead>
        {groups.map(([role, rows, total]) => (
          <tbody key={role}>
            <tr>
              <td colSpan={6} className="label pt-4">
                {GROUP[role] ?? role} · {total}
              </td>
            </tr>
            {rows.map((m) => (
              <tr
                key={m.player_tag}
                data-you={m.you ? "true" : undefined}
                className={m.you ? "bg-panel-raised" : undefined}
              >
                <td title={m.player_tag}>
                  <span className="inline-flex items-center gap-2">
                    {m.you ? (
                      <span className="yours" title="You">
                        ★
                      </span>
                    ) : null}
                    <span
                      className={
                        m.you
                          ? "font-semibold text-ink"
                          : "font-medium text-ink"
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
                          {m.name ?? m.player_tag}
                        </Link>
                      ) : (
                        (m.name ?? m.player_tag)
                      )}
                    </span>
                    {m.you ? (
                      <span className="chip chip--info px-2 py-0 text-[11px]">
                        you
                      </span>
                    ) : null}
                  </span>
                </td>
                <td>
                  <RoleChip role={m.role} label={m.role_label} />
                </td>
                <td className="text-right font-mono">{num(m.trophies)}</td>
                <td className="text-right font-mono">
                  {num(m.donations_this_week)}
                </td>
                <td title={m.last_seen_in_game ?? undefined}>
                  {m.last_seen_in_game ? (
                    ago(m.last_seen_in_game, at)
                  ) : (
                    <span className="nil">—</span>
                  )}
                </td>
                <td title={m.last_recorded_battle ?? undefined}>
                  {m.last_recorded_battle ? (
                    ago(m.last_recorded_battle, at)
                  ) : (
                    <span className="nil">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        {hidden.length ? (
          <tbody>
            <tr>
              <td colSpan={6}>
                <button
                  type="button"
                  className="btn btn--sm btn--quiet"
                  onClick={onMore}
                >
                  <Icon name="chevron-down" size={14} />
                  {hidden.length} more{" "}
                  {hidden.length === 1 ? "member" : "members"}
                  {floor.length
                    ? `, down to ${num(Math.min(...floor))} trophies`
                    : ""}
                </button>
              </td>
            </tr>
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

/** What a joiner is asked, as the game says it, then what the page is. */
function ledeFor(roster) {
  const ask = [
    roster?.type ? (TYPE[roster.type] ?? roster.type) : null,
    roster?.required_trophies != null
      ? `${num(roster.required_trophies)} trophies to join`
      : null,
  ].filter(Boolean);
  return `${ask.length ? `${ask.join(", ")}. ` : ""}The roster as the game reports it, with when each member was last seen and last recorded in a battle.`;
}

export function ClanHeader({ clan, roster, others = [], navigate }) {
  const clanName = roster?.name ?? clan.name ?? clan.clan_tag;
  const [open, setOpen] = useState(false);
  const chip = (
    <>
      <span className="yours">★</span> {clan.acting_as_name ?? clan.acting_as}
      <span className="text-ink-faint">·</span>
      <RoleChip role={clan.role} label={clan.role_label} />
      <span className="text-ink-faint">·</span>
      {clanName}
    </>
  );
  return (
    <PageHead
      clan={clan}
      name={clanName}
      title={clanName}
      lede={roster ? ledeFor(roster) : null}
      navigate={navigate}
      fresh={
        roster?.meta ? (
          <Fresh
            label="as of"
            seconds={roster.meta.freshness_seconds}
            ts={roster.meta.as_of}
          />
        ) : null
      }
    >
      <div>
        {others.length > 0 ? (
          <span className="relative">
            {/* .chip sets no background, so a BUTTON wearing it kept the
                browser's grey buttonface under light ink (axe: contrast). */}
            <button
              type="button"
              className="chip cursor-pointer border-0 bg-transparent text-inherit [font:inherit]"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {chip} <span aria-hidden="true">▾</span>
            </button>
            {open ? (
              <div
                role="menu"
                className="panel absolute top-[110%] left-0 z-20 min-w-[260px]"
              >
                {others.map((c) => (
                  <a
                    key={c.clan_tag}
                    role="menuitem"
                    href={clanPath(c.clan_tag)}
                    onClick={(e) => {
                      e.preventDefault();
                      setOpen(false);
                      navigate(clanPath(c.clan_tag));
                    }}
                    className="flex items-center gap-2 px-3.5 py-2.5 text-inherit"
                  >
                    <span>{c.name ?? c.clan_tag}</span>
                    <RoleChip role={c.role} label={c.role_label} />
                  </a>
                ))}
                <a
                  role="menuitem"
                  href={`${CLAN}/clans`}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    navigate(`${CLAN}/clans`);
                  }}
                  className="block px-3.5 py-2.5 border-t border-line-soft text-[13px]"
                >
                  All your clans ›
                </a>
              </div>
            ) : null}
          </span>
        ) : (
          <span className="chip">{chip}</span>
        )}
      </div>
    </PageHead>
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
              ? `${ordinal(race.rank)} in race ${race.season_id}/${race.section_index}${change}`
              : "the game's own figure"
          }
        />
      ) : null}
      {roster.donations_per_week !== null &&
      roster.donations_per_week !== undefined ? (
        <Tile
          label="Donations a week"
          value={num(roster.donations_per_week)}
          hint="the game's own figure"
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
  const { stamp } = useClock();
  const base = clanPath(clan.clan_tag);
  // History is the leaders' (the rail's Manage group); everyone else
  // reads the same comings and goings week by week.
  const more = history ? `${base}/manage/history` : `${base}/week`;
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
    const who = <b className="text-ink">{e.name ?? e.player_tag}</b>;
    if (e.type === "member_joined")
      return cameBack(e) ? <>{who} came back</> : <>{who} joined</>;
    if (e.type === "member_left") return <>{who} departed</>;
    return `Finished ${ordinal(e.rank)} in ${e.is_colosseum ? "the Colosseum, " : ""}race ${e.season_id}/${e.section_index}${e.fame !== null ? ` with ${num(e.fame)} fame` : ""}`;
  };
  const rows = (roster.comings ?? []).filter(
    (e) => e.type !== "week_resolved" || e.rank !== null,
  );
  return (
    <section className="panel" aria-labelledby="clan-comings">
      <div className="panel__head">
        <h2 id="clan-comings" className="m-0 grow text-[14px] font-semibold">
          Comings and goings
        </h2>
        <a className="text-[13px] font-normal" href={more} onClick={go(more)}>
          {history ? "History ›" : "The week ›"}
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
                  {stamp(e.at)}
                </span>
              </div>
            );
          })
        ) : (
          <p className="page-head__note my-2.5">
            Nobody has joined or departed since Elixir began recording the
            roster
            {roster.events_recorded_since
              ? ` (${stamp(roster.events_recorded_since)})`
              : ""}
            .
          </p>
        )}
      </div>
    </section>
  );
}

/** The one page. Reads /api/roster once per mount; the API caches it per
 *  session for a few minutes, and "Check again" is rate-limited there. */
export function Clan({ me, clan, navigate, search }) {
  const others = (me.clans ?? []).filter((c) => c.clan_tag !== clan.clan_tag);

  const tag = clan.clan_tag;
  const gated = useRoster(tag);
  const state = { ...gated.state, roster: gated.state.data };
  const load = gated.load;
  const [all, setAll] = useState(false);
  const [localFind, setFind] = useState("");
  const find = search ?? localFind;

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
  const history =
    LEADERS.has(clan.role) && (policy?.active ?? policy?.set === true);

  return (
    <ZoneProvider zone={roster?.meta?.timezone_applied ?? null}>
      <ClanHeader
        clan={clan}
        roster={roster}
        others={others}
        navigate={navigate}
      />
      {state.loading && !roster ? (
        <p className="page__lede">Reading the roster from Elixir…</p>
      ) : state.error ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Elixir did not answer the roster read. Nothing is stored here to
            fall back on; try again in a minute.
          </span>
        </div>
      ) : roster?.not_recorded ? (
        <div className="empty">
          <div className="empty__title">
            Elixir is not recording {clan.name ?? roster.clan_tag} yet
          </div>
          <p className="empty__body">
            Your player is in this clan, but the clan itself is not on
            Elixir&rsquo;s record, so there is no roster to read. Add it under
            Elixir → Tracking (clans), and the roster arrives with the first
            poll.
          </p>
          <a className="btn btn--primary" href={ELIXIR_LINKS.tracking}>
            Elixir → Tracking ›
          </a>
        </div>
      ) : roster ? (
        <>
          <ClanTiles roster={roster} />
          {spread && spread !== "active" ? (
            <div className="mb-[22px]">
              <SpreadWord
                me={me}
                clan={clan}
                roster={roster}
                navigate={navigate}
              />
            </div>
          ) : null}
          <div className="grid gap-4 items-start wide:grid-cols-3">
            <section
              className="panel min-w-0 wide:col-span-2"
              aria-labelledby="clan-roster"
            >
              <div className="panel__head">
                <h2
                  id="clan-roster"
                  className="m-0 grow text-[14px] font-semibold"
                >
                  Roster
                </h2>
                {members.length ? (
                  <label className="flex items-center gap-2 h-8 px-3 rounded-control border border-line bg-ground-sunken text-[13px] font-normal text-ink-faint">
                    <Icon name="search" size={14} />
                    <input
                      type="search"
                      value={find}
                      onChange={(e) => {
                        const next = e.target.value.slice(0, 100);
                        if (navigate && search != null)
                          navigate(
                            clanPath(tag) +
                              (next
                                ? `?${new URLSearchParams({ find: next })}`
                                : ""),
                            { replace: true },
                          );
                        else setFind(next);
                      }}
                      placeholder="Find a member"
                      aria-label="Find a member"
                      className="w-[150px] border-0 bg-transparent text-ink outline-none [font:inherit]"
                    />
                  </label>
                ) : null}
              </div>
              <div className="px-1.5 pb-1.5">
                {members.length === 0 ? (
                  <div className="empty">
                    <div className="empty__title">No members on the record</div>
                    <p className="empty__body">
                      Elixir knows the clan but has not carried a member for it
                      yet. That resolves on its next roster poll.
                    </p>
                  </div>
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
                  {roster.meta?.as_of
                    ? ` · Elixir recorded the roster ${ago(roster.meta.as_of)}`
                    : ""}
                  {roster.cached_at ? ` · read ${ago(roster.cached_at)}` : ""}
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
            </section>
            <div className="grid gap-4 min-w-0">
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
          </div>
        </>
      ) : null}
    </ZoneProvider>
  );
}
