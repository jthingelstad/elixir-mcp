import { useState } from "react";
import { ACTION_ORDER as ORDER } from "@elixir-mcp/clan-engine";
import {
  Empty,
  ErrorState,
  Fresh,
  Panel,
  Tag,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import {
  useActions,
  useHistory,
  useMemberView,
  useWeek,
} from "../lib/queries.js";
import {
  LeaderMessageNotice,
  ActionLog,
  CopyLine,
} from "../components/ActionCard.jsx";
import {
  InviteLeaders,
  SetupPolicy,
  SmallClan,
} from "../components/SpreadWord.jsx";
import {
  CardHead,
  HowYouAreDoing,
  statusChip,
} from "../components/YouHereCard.jsx";
import { Tile, Tiles } from "../components/PageHead.jsx";
import { ActionList, DiscordNudge } from "./Actions.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { leads } from "../lib/tabs.js";
import { date, n, plural, raceSentence, seasonWeek } from "../lib/words.js";

const rank = (t) => {
  const i = ORDER.indexOf(t);
  return i < 0 ? ORDER.length : i;
};

/** The numbers of your week, each only when the record holds it. */
function YouThisWeek({ d }) {
  const y = d.you;
  const war = y.this_war_week;
  return (
    <Tiles label="This week so far">
      {war ? (
        <Tile
          label="War decks"
          value={n(war.decks)}
          hint={`${seasonWeek(war)}, so far`}
        />
      ) : null}
      <Tile
        label="Path of Legends battles"
        value={n(y.this_week?.ranked_battles)}
        hint="since Monday"
      />
      <Tile label="Donations" value={n(y.this_week?.donations)} />
      <Tile label="Battles" value={n(y.this_week?.battles)} />
      <Tile label="Trophies" value={n(y.trophies)} hint="as of the last read" />
    </Tiles>
  );
}

/** "You in <clan>": your own group, numbers and clock, and the way to them. */
function YouCard({ clan, base, navigate }) {
  const { state } = useMemberView(clan.clan_tag);
  const d = state.data;
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const title = `You in ${clan.name ?? clan.clan_tag}`;
  if (state.error || state.forbidden)
    return (
      <Panel aria-labelledby="today-you">
        <CardHead id="today-you" title={title} />
        <p className="panel__body m-0 text-ink-dim">
          {state.error === "not_on_roster"
            ? "Elixir's record does not show you on this clan's roster yet."
            : "Your activity could not be read just now."}
        </p>
      </Panel>
    );
  if (!d)
    return (
      <Panel aria-labelledby="today-you">
        <CardHead id="today-you" title={title} />
        <p className="panel__body m-0 text-ink-dim">Reading your numbers…</p>
      </Panel>
    );
  const chip = d.clan?.status ? statusChip(d.clan.status) : null;
  const own = `${base}/members/${String(clan.acting_as).slice(1)}`;
  const how = `${base}/policy`;
  const away = `${base}/members/away`;
  return (
    <Panel aria-labelledby="today-you">
      <CardHead id="today-you" title={title}>
        {chip ? <span className={`chip ${chip[1]}`}>{chip[0]}</span> : null}
      </CardHead>
      <div className="panel__body grid gap-3">
        <HowYouAreDoing d={d} base={base} navigate={navigate} />
        <h4 className="label m-0">This week so far</h4>
        <YouThisWeek d={d} />
        <div className="flex flex-wrap gap-2">
          <a className="btn btn--sm" href={own} onClick={go(own)}>
            Your record here
          </a>
          {d.clan ? (
            <a className="btn btn--sm" href={how} onClick={go(how)}>
              How it works here
            </a>
          ) : null}
          {d.clan ? (
            <a className="btn btn--sm" href={away} onClick={go(away)}>
              {d.hold?.kind === "away" ? "Change it" : "Going to be away?"}
            </a>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/** "This week": what the clan did together, the week still running or, once
 *  the race has closed the week, the one that closed. */
function WeekCard({ clan, base, navigate }) {
  const { state } = useWeek(clan.clan_tag, null);
  const d = state.data;
  const season = `${base}/war`;
  const open = (
    <a
      className="btn btn--sm"
      href={season}
      onClick={(e) => {
        e.preventDefault();
        navigate?.(season);
      }}
    >
      Open War
    </a>
  );
  if (state.error || state.forbidden)
    return (
      <Panel aria-labelledby="today-week">
        <CardHead id="today-week" title="This week" />
        <p className="panel__body m-0 text-ink-dim">
          {state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet."
            : "Elixir did not answer. Try again in a minute."}
        </p>
      </Panel>
    );
  if (!d)
    return (
      <Panel aria-labelledby="today-week">
        <CardHead id="today-week" title="This week" />
        <p className="panel__body m-0 text-ink-dim">Reading the week…</p>
      </Panel>
    );
  const running = d.so_far;
  const closedWar = d.areas?.find((a) => a.key === "war")?.war ?? null;
  const areas = running?.areas ?? d.areas ?? [];
  const war = areas.find((a) => a.key === "war");
  const took = (a) => a.took_part ?? a.participants?.length ?? 0;
  const label = running
    ? `${seasonWeek(war?.war) ?? `The week of ${date(running.from)}`}, so far`
    : d.week
      ? `${seasonWeek(closedWar) ?? `The week of ${date(d.week.from)}`}, closed ${date(d.week.closed_at ?? d.week.to)}`
      : null;
  const donation = areas.find((a) => a.key === "donations");
  const battles = areas.find((a) => a.key === "battles");
  const m = running?.membership ?? d.membership;
  const highlight = running?.highlight ?? d.highlight;
  const quiet = areas.every((a) => !a.total);
  const last = raceSentence(closedWar);
  return (
    <Panel aria-labelledby="today-week">
      <CardHead id="today-week" title="This week">
        {open}
      </CardHead>
      <div className="panel__body grid gap-2.5">
        {label ? <p className="m-0 text-ink-dim">{label}</p> : null}
        {quiet ? (
          <p className="m-0">
            {highlight?.basis === "policy"
              ? "Nothing the clan counts was recorded this week."
              : "No member took part in anything Elixir recorded this week."}
          </p>
        ) : (
          <dl className="fields kit-kv m-0">
            {war ? (
              <>
                <dt className="label">War decks played</dt>
                <dd className="m-0">
                  {n(war.total)}, by {plural(took(war), "member")}
                </dd>
              </>
            ) : null}
            {war?.points !== null && war?.points !== undefined ? (
              <>
                <dt className="label">Points</dt>
                <dd className="m-0">{n(war.points)}</dd>
              </>
            ) : null}
            {donation ? (
              <>
                <dt className="label">Donations</dt>
                <dd className="m-0">
                  {n(donation.total)}, by {plural(took(donation), "member")}
                </dd>
              </>
            ) : null}
            {battles ? (
              <>
                <dt className="label">Battles</dt>
                <dd className="m-0">
                  {n(battles.total)}, by {plural(took(battles), "member")}
                </dd>
              </>
            ) : null}
            {m?.joined?.length || m?.departed?.length ? (
              <>
                <dt className="label">Came and went</dt>
                <dd className="m-0">
                  {m.joined.length} joined, {m.departed.length} departed
                </dd>
              </>
            ) : null}
          </dl>
        )}
        {last ? <p className="m-0 text-ink-dim">Last race: {last}.</p> : null}
      </div>
    </Panel>
  );
}

const CLASS_WORDS = {
  member_kicked: "was removed",
  member_left: "left",
  ignored: "departed",
};

/** One line of who came and went, in the record's own words: "departed" until
 *  a leader says otherwise. */
function cameAndWent(e) {
  const who = e.name ?? e.player_tag;
  const was = e.role_before ? ` (was ${e.role_before})` : "";
  if (e.type === "member_joined") return `${who} joined`;
  if (e.type === "role_changed")
    return `${who}: ${e.role_before ?? "?"} to ${e.role_after}`;
  return `${who} ${CLASS_WORDS[e.classification] ?? "departed"}${was}`;
}

const OUTCOME = {
  done: "Done",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

/** Decided: the leaders' record, every decision and who came and went. */
function Decided({ clan, navigate }) {
  const { whenDay, calendar } = useClock();
  const { data, isError } = useHistory(clan.clan_tag);
  const [now] = useState(() => Date.now());
  if (isError)
    return (
      <ErrorState title="This page did not load">
        Check your clan access or try again.
      </ErrorState>
    );
  if (!data) return <p className="page__lede">Reading the decisions…</p>;
  const base = clanPath(clan.clan_tag);
  const recent = data.cards.filter(
    (c) => now - Date.parse(c.decided_at ?? c.raised_at) <= 30 * 86_400_000,
  );
  const shown = recent.slice(0, 30);
  const older = data.cards.filter((c) => !shown.includes(c));
  const row = (c) => {
    const to = `${base}/actions/${c.number}`;
    const link = Number.isInteger(c.number) && c.audience?.kind !== "member";
    return (
      <li key={c.card_id} className="clan-row">
        <span className="clan-row__main">
          <span className="clan-row__title">
            {Number.isInteger(c.number) ? (
              <span className="mono mr-2 font-normal text-ink-faint">
                #{c.number}
              </span>
            ) : null}
            {link ? (
              <a
                href={to}
                onClick={(e) => {
                  e.preventDefault();
                  navigate?.(to);
                }}
              >
                {c.label}
              </a>
            ) : (
              c.label
            )}
            {c.player_tag ? (
              <>
                {" · "}
                {c.player_name ?? <Tag tag={c.player_tag} />}
              </>
            ) : null}
          </span>
          <span className="clan-row__meta">
            {c.decided_by_name ? `${c.decided_by_name}, ` : ""}
            {c.decided_at ? whenDay(c.decided_at) : whenDay(c.raised_at)}
            {c.decline_reason
              ? ` · ${c.decline_reason.replaceAll("_", " ")}`
              : ""}
            {c.decision_note ? ` · ${c.decision_note}` : ""}
            {c.withdraw_reason ? ` · ${c.withdraw_reason}` : ""}
          </span>
          <details className="mt-1">
            <summary className="page-head__note cursor-pointer">
              Log · {(c.log ?? []).length}
            </summary>
            <div className="mt-2">
              <ActionLog action={c} clan={clan} />
            </div>
          </details>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          <span
            className={`chip ${c.status === "done" ? "chip--ok" : c.status === "declined" ? "chip--warn" : ""}`.trim()}
          >
            {OUTCOME[c.status] ?? c.status}
          </span>
          {c.outcome?.verified_at ? (
            <span className="chip chip--ok">
              {c.outcome.delay_hours != null
                ? `Seen ${Math.round(c.outcome.delay_hours)} h later`
                : "Seen in the game"}
            </span>
          ) : null}
          {c.outcome?.flagged_at ? (
            <span className="chip chip--bad">Flagged: no change seen</span>
          ) : null}
        </span>
      </li>
    );
  };
  const timeline = data.timeline ?? [];
  return (
    <div className="grid gap-4">
      <Panel aria-labelledby="decided-actions">
        <CardHead id="decided-actions" title="Actions">
          <span className="page-head__note font-normal">
            Every one this clan has decided
          </span>
        </CardHead>
        {shown.length ? (
          <ul className="m-0 list-none p-0">{shown.map(row)}</ul>
        ) : (
          <p className="panel__body m-0 text-ink-dim">
            No action decided in the last 30 days.
          </p>
        )}
        {older.length ? (
          <details className="panel__foot">
            <summary className="cursor-pointer">
              Older actions · {older.length}
            </summary>
            <ul className="m-0 mt-2 list-none p-0">{older.map(row)}</ul>
          </details>
        ) : null}
      </Panel>
      <Panel aria-labelledby="decided-who">
        <CardHead id="decided-who" title="Who came and went">
          <span className="page-head__note font-normal">
            The 20 most recent
          </span>
        </CardHead>
        {timeline.length ? (
          <ul className="m-0 list-none p-0">
            {timeline.map((e) => (
              <li
                key={`${e.type}-${e.player_tag}-${e.at}`}
                className="clan-row"
              >
                <span className="clan-row__main">
                  <span>
                    <TagText>{cameAndWent(e)}</TagText>
                  </span>
                  {e.note ? (
                    <span className="clan-row__meta">{e.note}</span>
                  ) : null}
                  {e.copy ? <CopyLine text={e.copy} /> : null}
                </span>
                <span className="shrink-0 text-[12.5px] text-ink-faint">
                  {whenDay(e.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel__body m-0 text-ink-dim">
            Nobody joined, departed or changed role in this window.
          </p>
        )}
        {data.timeline_since ? (
          <div className="panel__foot">
            Roster recording began {whenDay(data.timeline_since)}. Older changes
            are not listed here.
          </div>
        ) : null}
      </Panel>
      {data.holds.length ? (
        <Panel aria-labelledby="decided-holds">
          <CardHead id="decided-holds" title="Holds" />
          <ul className="m-0 list-none p-0">
            {data.holds.map((h) => (
              <li key={h.player_tag} className="clan-row">
                <span className="clan-row__main">
                  <span className="clan-row__title">
                    {h.player_name ?? <Tag tag={h.player_tag} />}
                  </span>
                  <span className="clan-row__meta">
                    {h.kind === "away" ? "Marked away" : "On hold"}{" "}
                    {h.until
                      ? `until ${calendar(h.until)}`
                      : "with no end date"}
                    , set by {h.by_name ?? h.by} on {whenDay(h.set_at)}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/** Waiting: what this person can act on, in the engine's order, one line each;
 *  each line opens the action's own page. */
function Waiting({ d, clan, who, navigate, closedOpen, state, load }) {
  const lead = leads(clan);
  const open = [...d.open].sort(
    (a, b) => rank(a.type) - rank(b.type) || (a.number ?? 0) - (b.number ?? 0),
  );
  const base = clanPath(clan.clan_tag);
  const leaderMessages = open.filter((a) => a.channel === "leader_message");
  const lastLeaderCompletion = [...d.recent]
    .filter(
      (a) =>
        a.channel === "leader_message" && a.status === "done" && a.decided_at,
    )
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
  return (
    <div className="grid gap-4">
      {lead ? (
        <DiscordNudge
          discord={d.discord}
          to={`${base}/run/discord`}
          navigate={navigate}
        />
      ) : null}
      {leaderMessages.length ? (
        <LeaderMessageNotice count={leaderMessages.length}>
          {lastLeaderCompletion ? (
            <p className="page-head__note mb-0">
              <Fresh
                label={`Latest Done in Elixir: Action #${lastLeaderCompletion.number}`}
                ts={lastLeaderCompletion.decided_at}
              />{" "}
              This records a decision, not what the game has left to send.
            </p>
          ) : null}
        </LeaderMessageNotice>
      ) : null}
      {open.length === 0 ? (
        <Empty title="Nothing waiting for you">
          An action appears here when the clan&rsquo;s policy suggests something
          you can do. Elixir reads the clan each morning, and again when someone
          opens Standing or chooses Refresh suggestions.
          {state ? (
            <>
              {" "}
              <button
                type="button"
                className="btn--text"
                disabled={state.loading}
                onClick={() => load(true)}
              >
                {state.loading ? "Refreshing…" : "Refresh suggestions"}
              </button>
            </>
          ) : null}
        </Empty>
      ) : (
        <ActionList
          id="actions-waiting"
          title="Waiting for you"
          tone="chip--info"
          actions={open}
          clan={clan}
          who={who}
          navigate={navigate}
        />
      )}
      {!lead && d.recent.length ? (
        <details open={closedOpen} className="clan-fold">
          <summary className="label cursor-pointer">
            Closed in the last 30 days · {d.recent.length}
          </summary>
          <div className="mt-2">
            <ActionList
              id="actions-closed"
              title="Closed"
              tone="chip--mute"
              actions={d.recent}
              clan={clan}
              who={who}
              navigate={navigate}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * What waits for this person in the clan, in the state the clan is in: the
 * Feed shows it first to everyone (Clan as one view, 2026-11-12), and Run's
 * Waiting shows it to the leaders with "Refresh suggestions". A clan with no
 * policy or under ten members says what that means where the actions would
 * be.
 */
export function ActionsNow({ clan, who, closedOpen, navigate }) {
  const { state, query, load } = useActions(clan.clan_tag);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const lead = leads(clan);
  const d = state.data;
  if (state.error === "no_policy")
    return lead ? (
      <SetupPolicy clan={clan} navigate={navigate} />
    ) : (
      <InviteLeaders clan={clan} />
    );
  if (state.error === "too_few_members") {
    const e = query.data?.data ?? {};
    return (
      <SmallClan
        clan={clan}
        members={e.members}
        min={e.min_members}
        navigate={navigate}
      />
    );
  }
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>These Actions are unavailable for your current clan access.</span>
      </div>
    );
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>
          {state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet."
            : "Elixir did not answer. Try again in a minute."}
        </span>
      </div>
    );
  if (!d) return <p className="page__lede">Reading the record…</p>;
  return (
    <Waiting
      d={d}
      clan={clan}
      who={who}
      navigate={navigate}
      closedOpen={closedOpen}
      state={state}
      load={load}
    />
  );
}

/** Run's "Refresh suggestions": the actions read again, with `refresh=1`. */
export function RefreshSuggestions({ clan }) {
  const { state, load } = useActions(clan.clan_tag);
  return (
    <button
      type="button"
      className="btn btn--sm"
      disabled={state.loading}
      onClick={() => load(true)}
    >
      {state.loading ? "Refreshing…" : "Refresh suggestions"}
    </button>
  );
}

export { Decided, WeekCard, YouCard };
