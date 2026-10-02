import {
  FAMILY_PRODUCTS,
  gameLabel,
  Icon,
  Link,
  ago,
  secsSince,
  stampTime,
  useClock,
} from "@elixir-mcp/ui";
import { VerifiedMark } from "../../components/VerifiedMark.jsx";
import { useState } from "react";
import { useBattleActivity, useMyClans, useUsage } from "../../lib/queries.js";
import { tagPath } from "../../lib/tag-url.js";
import { quotaReading } from "../../lib/quota.js";
import { FirstAnswer } from "../../components/FirstAnswer.jsx";
import { ActivityGraph } from "../../components/ActivityGraph.jsx";
import { CONSOLE } from "../../lib/console.js";

/**
 * Overview REPORTS; Tracking manages.
 *
 * The 2026-09-09 design split the reading from the doing: a landing page
 * that says whether the thing is working and where to go if it is not,
 * and nothing on it that can be got wrong. No table, no toggle, no form.
 *
 * Drawn to the 2026-09-29 canvas (Console › Overview): the headline and
 * a "live" pill, then ACROSS ELIXIR, your Ladder and your clan plus the
 * game, then your players and clans as short lists into Tracking, and
 * today's calls. Every figure is one the console already holds: the
 * canvas's trophies, season record and war-day count have no source the
 * console can read without spending the reader's metered calls, so the
 * Ladder and Clan tiles say where to go rather than invent a number.
 * The battle-activity year stays, below (Jamie, 2026-09-13: "too cool
 * to not have prominent on the Overview page").
 */

/** Players in the order the canvas lists them: you, your other
 *  accounts, your friends, then the players you watch. */
const RANK = { primary: 0, alt: 1, friend: 2, watching: 3 };
const rankOf = (c) => (c.is_primary ? 0 : (RANK[c.relationship] ?? 3));
const nameOf = (c) => c.nickname ?? c.name ?? c.player_tag;

/** How many rows each list shows before "and N more": four at width,
 *  two on a phone (the Phone board). */
const WIDE_ROWS = 4;
const NARROW_ROWS = 2;

/** The pill beside the headline: when the primary player was last read.
 *  Green within the hour, amber within the day, quiet after. */
function LivePill({ me }) {
  const { zone } = useClock();
  const [now] = useState(() => Date.now());
  const primary = (me.claims ?? []).find((c) => c.is_primary);
  const rec = primary
    ? me.recordings?.find((r) => r.subject_tag === primary.player_tag)
    : null;
  const s = secsSince(rec?.freshest_poll, now);
  if (s == null) return null;
  if (s < 3600)
    return (
      <span className="chip chip--ok whitespace-nowrap">
        <span className="chip__dot" />
        live · last read {stampTime(rec.freshest_poll, zone)}
      </span>
    );
  return (
    <span
      className={`chip whitespace-nowrap ${s < 86400 ? "chip--warn" : "text-ink-faint"}`}
    >
      last read {ago(rec.freshest_poll, now)}
    </span>
  );
}

/** One of the three tiles across Elixir. The whole tile is the link. */
function Tile({ to, icon, title, aside, children, more, className = "" }) {
  return (
    <Link
      to={to}
      className={`panel flex flex-col gap-3.5 px-5 py-[18px] text-ink hover:text-ink ${className}`}
    >
      <span className="flex items-center gap-2.5">
        <Icon name={icon} size={18} />
        <span className="flex-auto text-[14px] font-semibold">{title}</span>
        {aside}
      </span>
      {children}
      <span className="mt-auto text-[13px] text-ink-link">{more}</span>
    </Link>
  );
}

function Across({ me, clans }) {
  const primary = (me.claims ?? []).find((c) => c.is_primary);
  const home = clans?.home_clan ?? null;
  const tracked = home
    ? (clans?.clans ?? []).find((c) => c.clan_tag === home.clan_tag)
    : null;
  const drop = FAMILY_PRODUCTS.find((p) => p.game);
  return (
    <section aria-labelledby="across" className="mb-6">
      <div className="mb-3 flex items-baseline gap-3">
        <h2
          id="across"
          className="m-0 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint"
        >
          Across Elixir
        </h2>
        <span className="text-[12.5px] text-ink-faint">
          your Ladder and your clan, plus a game
        </span>
      </div>
      <div className="grid gap-4 wide:grid-cols-3">
        <Tile
          to="/ladder"
          icon="chart-line"
          title="Ladder · Trophy Road"
          more="Your season ›"
        >
          <span className="text-[13.5px] leading-normal text-ink-body">
            {primary ? (
              <>
                <span className="font-semibold text-ink">
                  {nameOf(primary)}
                </span>
                &rsquo;s season: battles, record and win rate, week by week.
              </>
            ) : (
              "Your season: battles, record and win rate, week by week."
            )}
          </span>
        </Tile>
        <Tile
          to={home ? `/clan/${tagPath(home.clan_tag)}/week` : "/clan"}
          icon="users"
          title={home ? `Clan · ${home.name ?? home.clan_tag}` : "Clan"}
          more={home ? "The week in the clan ›" : "Elixir Clan ›"}
        >
          {tracked?.member_count ? (
            <span className="flex items-baseline gap-2">
              <span className="mono text-[26px] font-semibold text-ink max-wide:text-[24px]">
                {tracked.member_count}
              </span>
              <span className="text-[13.5px] text-ink-body">
                members on record
              </span>
            </span>
          ) : (
            <span className="text-[13.5px] leading-normal text-ink-body">
              {home
                ? "Your player's clan: its week, its standing and the actions waiting on its leaders."
                : "Your clan's week, its standing and the actions waiting on its leaders."}
            </span>
          )}
        </Tile>
        {drop && (
          // On a phone the game is in the bar's menu; the canvas leaves
          // the tile out there.
          <a
            className="drop-card max-wide:hidden"
            href={drop.href}
            target="_blank"
            rel="noopener"
            aria-label={gameLabel(drop)}
          >
            <span className="flex items-center gap-2.5">
              <Icon name="gamepad-2" size={18} />
              <span className="drop-card__name">{drop.label}</span>
              <span className="drop-card__kind">a game</span>
            </span>
            <span className="drop-card__about">
              Guess the elixir cost before the drop. Ranked games, Practice,
              badges and seasons.
            </span>
            <span className="drop-card__play">
              <Icon name={drop.icon} size={17} />
              {drop.action ?? drop.label}
              <Icon name="arrow-up-right" size={14} />
            </span>
          </a>
        )}
      </div>
    </section>
  );
}

/** A short list's head: its name, its count, and the way to Tracking. */
function ListHead({ id, title, count }) {
  return (
    <div className="panel__head">
      <h2 id={id} className="m-0 flex-auto text-[14px] font-semibold">
        {title} <span className="font-medium text-ink-faint">{count}</span>
      </h2>
      <Link className="text-[13px]" to={`${CONSOLE}/account/tracking`}>
        Tracking ›
      </Link>
    </div>
  );
}

/** One row of the short lists: a link into the thing's Tracking record.
 *  `narrow` false hides the row on a phone, where the list is shorter. */
function Row({ to, star, name, tag, note, strong, narrow = true }) {
  return (
    <Link
      to={to}
      className={`flex min-h-12 items-center gap-3 border-b border-line-row px-[18px] py-[11px] last:border-b-0 ${narrow ? "" : "max-wide:hidden"}`}
    >
      {star !== undefined && (
        <span className="flex w-3.5 flex-none text-gold">
          {star && <Icon name="star" size={14} />}
        </span>
      )}
      <span className="flex min-w-0 flex-auto flex-col gap-px">
        <span
          className={`text-[14px] text-ink ${strong ? "font-semibold" : "font-medium"}`}
        >
          {name}
        </span>
        <span className="mono text-[12px] text-ink-link">{tag}</span>
      </span>
      {note && (
        <span
          className={`text-right text-[12.5px] max-wide:hidden ${strong ? "text-ink-dim" : "text-ink-faint"}`}
        >
          {note}
        </span>
      )}
    </Link>
  );
}

/** The last row of a list that does not fit: who is next, and how many
 *  more. Two spellings, one per width, because the phone shows fewer. */
function More({ rest, restNarrow }) {
  const line = (list) =>
    list.length === 1
      ? nameOf(list[0])
      : `${nameOf(list[0])}, and ${list.length - 1} more`;
  if (restNarrow.length === 0) return null;
  return (
    <Link
      to={`${CONSOLE}/account/tracking`}
      className={`flex min-h-12 items-center gap-3 px-[18px] py-[11px] text-[13.5px] text-ink-dim ${rest.length ? "" : "wide:hidden"}`}
    >
      <span className="w-3.5 flex-none" />
      {rest.length > 0 && (
        <span className="flex-auto max-wide:hidden">{line(rest)}</span>
      )}
      <span className="flex-auto wide:hidden">{line(restNarrow)}</span>
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}

/** The primary's line: its battles in the last 28 days, and whether
 *  every one of those days was watched. The same reading the activity
 *  graph below is drawn from, so it costs nothing more. */
function usePrimaryNote(primary) {
  const activity = useBattleActivity(primary?.player_tag ?? null);
  const a = activity.data;
  if (!a || a.battles_28d == null) return "you";
  const last = (a.days ?? []).slice(-28);
  const all = last.length === 28 && last.every((d) => d.status === "recorded");
  return `${a.battles_28d.toLocaleString()} battle${a.battles_28d === 1 ? "" : "s"} in 28 days${all ? " · all captured" : ""}`;
}

function Players({ me, navigate }) {
  const players = [...(me.claims ?? [])].sort((a, b) => rankOf(a) - rankOf(b));
  const primary = players.find((c) => c.is_primary);
  const primaryNote = usePrimaryNote(primary);
  const note = (c) =>
    c.is_primary
      ? primaryNote
      : c.relationship === "alt"
        ? "you"
        : (c.relationship ?? "watching");
  return (
    <section aria-labelledby="ov-players" className="panel">
      <ListHead id="ov-players" title="Players" count={players.length} />
      {players.length === 0 ? (
        <div className="empty m-4">
          <p className="empty__body">
            No players yet — nothing here defaults to you.
          </p>
          <button
            className="btn btn--primary"
            onClick={() => navigate(`${CONSOLE}/account/tracking`)}
          >
            Add your player
          </button>
        </div>
      ) : (
        <>
          {players.slice(0, WIDE_ROWS).map((c, i) => (
            <Row
              key={c.player_tag}
              to={`${CONSOLE}/account/tracking/${tagPath(c.player_tag)}`}
              star={c.is_primary}
              name={
                <>
                  {nameOf(c)}
                  {c.status === "verified" && <VerifiedMark />}
                </>
              }
              tag={c.player_tag}
              note={note(c)}
              strong={c.is_primary}
              narrow={i < NARROW_ROWS}
            />
          ))}
          <More
            rest={players.slice(WIDE_ROWS)}
            restNarrow={players.slice(NARROW_ROWS)}
          />
        </>
      )}
    </section>
  );
}

function Clans({ clansQuery }) {
  const clans = clansQuery.data ?? null;
  const rows = clans?.clans ?? [];
  const home = clans?.home_clan ?? null;
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.clan_tag === home?.clan_tag) -
      Number(a.clan_tag === home?.clan_tag),
  );
  const note = (c) =>
    [
      c.clan_tag === home?.clan_tag ? "your clan" : c.scope,
      c.member_count ? `${c.member_count} members` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <section aria-labelledby="ov-clans" className="panel">
      <ListHead
        id="ov-clans"
        title="Clans"
        count={clansQuery.isPending ? "" : rows.length}
      />
      {clansQuery.isError ? (
        <p className="field-error m-4">
          Your clans could not be read just now; try again shortly.
        </p>
      ) : clansQuery.isPending ? (
        <p className="m-4 text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-4 text-[13.5px] text-ink-dim">
          No clans yet. Add your player first: we offer their clan as soon as we
          see it.
        </p>
      ) : (
        <>
          {ordered.slice(0, WIDE_ROWS).map((c, i) => (
            <Row
              key={c.clan_tag}
              to={`${CONSOLE}/account/tracking/${tagPath(c.clan_tag)}`}
              name={c.name ?? c.clan_tag}
              tag={c.clan_tag}
              note={note(c)}
              strong={c.clan_tag === home?.clan_tag}
              narrow={i < NARROW_ROWS}
            />
          ))}
          <More
            rest={ordered
              .slice(WIDE_ROWS)
              .map((c) => ({ name: c.name ?? c.clan_tag }))}
            restNarrow={ordered
              .slice(NARROW_ROWS)
              .map((c) => ({ name: c.name ?? c.clan_tag }))}
          />
        </>
      )}
      {home && !rows.some((c) => c.clan_tag === home.clan_tag) && (
        <p className="m-0 border-t border-line-soft px-[18px] py-3 text-[12.5px] text-ink-faint">
          {home.name ?? home.clan_tag} is your player&rsquo;s clan, and is not
          tracked yet.
        </p>
      )}
    </section>
  );
}

/** Today's calls against the day's budget, and when the day turns over.
 *  Nothing while the reading is on its way or failed: the Usage page
 *  says why. */
function Today({ role }) {
  const { data: usage } = useUsage();
  const { zone } = useClock();
  if (!usage) return null;
  const q = quotaReading(usage, zone);
  return (
    <section
      aria-labelledby="ov-today"
      className="panel flex items-center gap-4 px-[18px] py-4"
    >
      <Icon name="chart-column" size={18} />
      <div className="flex min-w-0 flex-auto flex-col gap-0.5">
        <h2 id="ov-today" className="m-0 text-[14px] font-semibold">
          <span className="mono">{q.calls.used.toLocaleString()}</span> MCP call
          {q.calls.used === 1 ? "" : "s"} today
        </h2>
        <span className="text-[12.5px] text-ink-faint">
          {q.calls.limit == null
            ? `No daily cap${role ? ` on the ${role} tier` : ""}`
            : `${q.calls.label} for the day`}{" "}
          · the count {q.resets}
        </span>
      </div>
      <Link
        className="whitespace-nowrap text-[13px]"
        to={`${CONSOLE}/account/usage`}
      >
        Usage ›
      </Link>
    </section>
  );
}

/**
 * The account's battle activity (Jamie, 2026-09-13). Opens on the
 * primary player; a chip per other tracked player switches the graphic
 * without leaving the page. Each player's own record page carries the
 * same graphic beside its capture details.
 */
function OverviewActivity({ players }) {
  const first = players.find((p) => p.is_primary) ?? players[0];
  const [tag, setTag] = useState(first?.player_tag ?? null);
  // Keyed on the tag, so switching players shows that player's loading
  // state and never the previous one's graphic.
  const activity = useBattleActivity(tag);
  const data = activity.error
    ? { error: activity.error.status }
    : (activity.data ?? null);
  if (!first) return null;
  const chosen = players.find((p) => p.player_tag === tag) ?? first;
  return (
    <section className="panel mt-6">
      <div className="panel__head activity__head">
        <span>Battle activity</span>
        <span className="activity__who">
          {players.length > 1 ? (
            players.map((p) => (
              <button
                key={p.player_tag}
                type="button"
                className={
                  "chip activity__chip" +
                  (p.player_tag === chosen.player_tag
                    ? " activity__chip--on"
                    : "")
                }
                aria-pressed={p.player_tag === chosen.player_tag}
                onClick={() => setTag(p.player_tag)}
              >
                {nameOf(p)}
              </button>
            ))
          ) : (
            <span className="chip">{nameOf(chosen)}</span>
          )}
        </span>
        <Link
          className="ml-auto text-[13px]"
          to={`${CONSOLE}/account/tracking/${tagPath(chosen.player_tag)}`}
        >
          Record ›
        </Link>
      </div>
      {data === null ? (
        <p className="activity__empty">Loading…</p>
      ) : data.error ? (
        <p className="activity__empty">
          The activity graphic could not be loaded right now.
        </p>
      ) : (
        <ActivityGraph data={data} />
      )}
    </section>
  );
}

export function Overview({ me, navigate }) {
  const clansQuery = useMyClans();
  const clans = clansQuery.data ?? null;

  const players = me.claims ?? [];
  const clanRows = clans?.clans ?? [];
  // "Brand new" is derived from the record, not stored: no players, no
  // clans. The greeting and the lede are the only two places the state
  // shows, and both say what to do next rather than that it is empty.
  const fresh = players.length === 0 && clanRows.length === 0;

  return (
    <>
      <div className="page__crumb flex items-center gap-2 text-ink-faint">
        <span>Console</span>
        <Icon name="chevron-right" size={14} />
        <span className="text-ink-dim">Overview</span>
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-auto">
          <h1 className="page__title">
            {fresh ? "Your account is open" : "Everything is recording"}
          </h1>
          <p className="page__lede">
            {fresh
              ? "Add the player you play as. Capture starts on the next poll, usually within half an hour."
              : `${players.length} player${players.length === 1 ? "" : "s"} and ${clanRows.length} clan${clanRows.length === 1 ? "" : "s"} on record. Nothing needs you today.`}
          </p>
        </div>
        <LivePill me={me} />
      </div>

      <FirstAnswer
        claimsKey={players
          .map((c) => `${c.player_tag}:${c.is_primary}`)
          .join(",")}
      />

      {!fresh && <Across me={me} clans={clans} />}

      <div className="grid items-start gap-4 wide:grid-cols-2">
        <Players me={me} navigate={navigate} />
        <div className="flex flex-col gap-4">
          <Clans clansQuery={clansQuery} />
          <Today role={me.role} />
        </div>
      </div>

      {players.length > 0 && <OverviewActivity players={players} />}
    </>
  );
}
