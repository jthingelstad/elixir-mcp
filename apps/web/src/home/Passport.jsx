import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Avatar,
  DetailSheet,
  Empty,
  ErrorState,
  Icon,
  Link,
  PageHead,
  PlayerName,
  STAMP_LEVELS,
  StampMark,
  StampTile,
  TagText,
  earnedDay,
  stampTitle,
  useFlash,
} from "@elixir-mcp/ui";
import { STAMPS, stampById } from "@elixir-mcp/stamps/catalog";
import { useNav } from "../App.jsx";
import { SETTINGS } from "../lib/settings.js";
import { playerHref } from "../lib/player.js";
import { accountHref } from "../lib/account.js";
import {
  GROUPS,
  PASSPORT,
  destinationHref,
  earnedMap,
  passportHref,
  passportIdOf,
  unitWord,
} from "../lib/passport.js";
import {
  useMyPassport,
  usePassport,
  useReconcilePassport,
} from "../lib/queries.js";

/**
 * A passport (#1015): /home/passport is yours, /home/account/<id>/passport
 * anyone's, under their account page (2026-11-15), for a signed-in member. Both draw the public projection; yours adds each
 * Stamp's exact progress and where to earn it, which only you see. Another
 * member's shows what was earned and when, and the rules, never progress,
 * a setting or a way onto a clan map.
 *
 * Opening your own also runs the reconciliation (useReconcilePassport).
 *
 * `?stamp=<id>` opens one Stamp's detail (the bell links there). Opening
 * and closing replace the address, so Back leaves the passport rather than
 * stepping through the sheets.
 */
export function PassportPage() {
  const { pathname, search } = useLocation();
  const id = passportIdOf(pathname);
  const own = id === null;
  const mine = useMyPassport(own);
  // Stamps a write could not grant at the time: settled in the background,
  // never before the passport shows, never a message when it fails.
  useReconcilePassport(own);
  const theirs = usePassport(id);
  const query = own ? mine : theirs;
  // Your own public link: said so only from what this session already
  // read. Reading /api/me/passport here would make the viewer's passport.
  const queryClient = useQueryClient();
  const ownId = queryClient.getQueryData(["me", "passport"])?.data?.passport
    ?.id;
  const title = own ? "Your passport" : "Passport";

  if (query.isPending)
    return (
      <div className="kit-home kit-passport">
        <PageHead title={title} />
        <p className="kit-tiny" role="status">
          Reading the passport…
        </p>
        <ul className="kit-stamp-grid" aria-hidden="true">
          {STAMPS.slice(0, 6).map((s) => (
            <li key={s.id}>
              <span className="kit-passport__skeleton" />
            </li>
          ))}
        </ul>
      </div>
    );
  const env = query.data;
  if (env?.status === 404)
    return (
      <div className="kit-home kit-passport">
        <PageHead title="Passport" />
        <Empty
          title="No passport at this address"
          action={
            <Link className="btn btn--sm" to={PASSPORT}>
              Open your passport
            </Link>
          }
        >
          The link may be mistyped or no longer in use.
        </Empty>
      </div>
    );
  if (query.isError || !env || env.status !== 200 || !env.data?.passport)
    return (
      <div className="kit-home kit-passport">
        <PageHead title={title} />
        <ErrorState
          title="This passport could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Its Stamps are safe. Try again in a moment.
        </ErrorState>
      </div>
    );
  return (
    <PassportView
      data={env.data}
      owner={own}
      yours={!own && ownId === id}
      stampId={search?.stamp ?? null}
    />
  );
}

function PassportView({ data, owner, yours, stampId }) {
  const navigate = useNav();
  const { pathname } = useLocation();
  const p = data.passport;
  const earned = earnedMap(p.earned);
  const progress = new Map(
    (owner ? (data.owner?.stamps ?? []) : []).map((s) => [s.stamp_id, s]),
  );
  const open = stampById(stampId) ? stampId : null;
  const closed = useRef(null);
  useEffect(() => {
    // Focus goes back to the mark the sheet was about, also when the sheet
    // opened from a link and no mark opened it.
    if (open || !closed.current) return;
    const el = document.querySelector(
      `[data-stamp="${CSS.escape(closed.current)}"]`,
    );
    closed.current = null;
    if (el instanceof HTMLElement) el.focus();
  }, [open]);
  const go = (s) =>
    navigate(s ? `${pathname}?stamp=${encodeURIComponent(s)}` : pathname, {
      replace: true,
    });
  const name = p.player?.name ?? p.display_name;
  return (
    <div className="kit-home kit-passport">
      <PageHead
        title={
          owner ? "Your passport" : <TagText>{`${name}’s passport`}</TagText>
        }
        sub={
          owner
            ? "Small marks for your Elixir story."
            : "Stamps earned in Elixir."
        }
      />
      {yours ? (
        <p className="kit-passport__foot">
          This is your passport as other members see it.{" "}
          <Link className="link" to={PASSPORT}>
            Open yours
          </Link>
        </p>
      ) : null}
      {owner || !p.id ? null : (
        <p className="kit-passport__foot">
          <Link className="link" to={accountHref(p.id)}>
            Open their account
          </Link>
        </p>
      )}
      <Who passport={p} owner={owner} count={earned.size} />
      {earned.size === 0 ? (
        <p className="kit-passport__foot">
          {owner
            ? "Your first marks are ahead. Pick a Stamp to see how to earn it."
            : "No Stamps earned yet."}
        </p>
      ) : null}
      {GROUPS.map((group) => (
        <section key={group} className="kit-passport__group">
          <h2>{group}</h2>
          <ul className="kit-stamp-grid">
            {STAMPS.filter((s) => s.group === group).map((s, i) => {
              const e = earned.get(s.id);
              return (
                <li key={s.id}>
                  <StampTile
                    stamp={s}
                    level={e?.level ?? 0}
                    day={e ? (e.earned_on ?? e.earned_before) : null}
                    before={Boolean(e && !e.earned_on && e.earned_before)}
                    tilt={i}
                    label={
                      e ? "Earned" : s.optional ? "Optional" : "Not earned"
                    }
                    name={`${stampTitle(s, e?.level ?? 0)}. ${statusLine(s, e)}`}
                    onClick={() => go(s.id)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {owner ? <OwnerActions id={p.id} /> : null}
      <p className="kit-passport__foot">
        Stamps are visible to Elixir members. They record milestones earned in
        Elixir, never wins, trophies or ranks. The gold mark beside a player
        shows which player is verified now.
      </p>
      {open ? (
        <StampSheet
          stamp={stampById(open)}
          entry={earned.get(open) ?? null}
          mine={progress.get(open) ?? null}
          owner={owner}
          onClose={() => {
            closed.current = open;
            go(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** "Earned 14 November 2026", "Earned before 14 November 2026", or what
 *  is still ahead, in words. */
function statusLine(stamp, entry) {
  if (!entry)
    return stamp.optional ? "Optional. Not earned yet." : "Not earned yet.";
  if (entry.earned_on) return `Earned ${earnedDay(entry.earned_on)}.`;
  if (entry.earned_before)
    return `Earned before ${earnedDay(entry.earned_before)}.`;
  return "Earned.";
}

/** Whose passport: the canonical avatar, name and verification mark. Gold
 *  only while the player is verified now; a claim says it is not; no
 *  player is the account's own icon and "New player". */
function Who({ passport, owner, count }) {
  const player = passport.player;
  const verified = player?.verified === true;
  return (
    <div className="kit-passport__who">
      {player ? (
        <Avatar
          name={player.name ?? player.tag}
          tag={player.tag}
          verified={verified}
          card={verified ? (player.avatar_card_id ?? null) : null}
        />
      ) : (
        <span className="kit-av kit-av--account" aria-hidden="true">
          <Icon name="user-round" size={20} />
        </span>
      )}
      <div className="kit-passport__who-main">
        <span className="kit-passport__who-name">
          {player ? (
            <Link className="link" to={playerHref(player.tag)}>
              <PlayerName tag={player.tag} verified={verified}>
                <TagText>{player.name ?? player.tag}</TagText>
              </PlayerName>
            </Link>
          ) : (
            passport.display_name
          )}
        </span>
        <span className="kit-passport__who-note">
          {!player ? (
            owner ? (
              <Link className="link" to={`${SETTINGS}/players/verify`}>
                Add your player
              </Link>
            ) : (
              "Elixir account"
            )
          ) : verified ? (
            player.tag
          ) : (
            "Player not verified"
          )}
        </span>
      </div>
      <span className="kit-passport__count">
        {count === 1 ? "1 Stamp" : `${count} Stamps`}
      </span>
    </div>
  );
}

function OwnerActions({ id }) {
  const [copied, flash] = useFlash();
  return (
    <div className="kit-passport__actions">
      <button
        type="button"
        className="btn"
        onClick={() => {
          navigator.clipboard?.writeText(
            `${window.location.origin}${passportHref(id)}`,
          );
          flash();
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
        {copied ? "Copied" : "Copy passport link"}
      </button>
      <Link className="btn" to={`${SETTINGS}/profile`}>
        Your profile
      </Link>
    </div>
  );
}

const NOTES = {
  on_the_map:
    "This Stamp shows the milestone only. The place is never shown here, and the Stamp opens no clan map.",
  player_verified:
    "This Stamp records the day a player was verified. The gold mark beside a player shows who is verified now.",
};

/** One Stamp's detail: the mark, its day, the rule and the levels; for
 *  the owner, the exact count and where to earn the next level. */
function StampSheet({ stamp, entry, mine, owner, onClose }) {
  const level = entry?.level ?? 0;
  const ladder = stamp.thresholds.length > 1;
  const done = level >= stamp.thresholds.length;
  const pr = mine?.progress;
  return (
    <DetailSheet title={stampTitle(stamp, level)} onClose={onClose}>
      <div className="kit-passport-sheet">
        <StampMark
          stamp={stamp}
          level={level}
          day={entry ? (entry.earned_on ?? entry.earned_before) : null}
          before={Boolean(entry && !entry.earned_on && entry.earned_before)}
          large
        />
        <p>
          <strong>{statusLine(stamp, entry)}</strong>
        </p>
        <p>{stamp.rule}</p>
        {NOTES[stamp.id] ? (
          <p className="kit-passport-sheet__note">{NOTES[stamp.id]}</p>
        ) : null}
        {ladder ? (
          <>
            <ul className="kit-passport-levels">
              {stamp.thresholds.map((n, i) => (
                <li key={n}>
                  <span>Level {STAMP_LEVELS[i + 1]}</span>
                  <span>
                    {n} {unitWord(stamp.id, n)}
                  </span>
                  <span>{level > i ? "Earned" : "Ahead"}</span>
                </li>
              ))}
            </ul>
            <p className="kit-passport-sheet__note">
              Totals, not streaks. Earned levels stay earned.
            </p>
          </>
        ) : null}
        {owner && pr && !done && pr.next != null && (ladder || pr.next > 1) ? (
          <p>
            Your progress: {pr.count} of {pr.next} {unitWord(stamp.id, pr.next)}
            .
          </p>
        ) : null}
        {owner && pr?.unknown && !done ? (
          <p className="kit-passport-sheet__note">
            Elixir is still catching up on some of this, so the count may be
            behind.
          </p>
        ) : null}
        {owner && !done ? (
          <Link
            className="btn btn--primary"
            to={destinationHref(stamp.destination)}
          >
            {stamp.action}
          </Link>
        ) : null}
      </div>
    </DetailSheet>
  );
}
