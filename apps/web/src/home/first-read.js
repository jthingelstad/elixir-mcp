import { useCallback, useEffect, useRef } from "react";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { trackEvent } from "../analytics.js";
import {
  FAST_WINDOW_MS,
  useFirstAnswer,
  useFirstReadLanded,
} from "../hooks/useFirstAnswer.js";
import { logRead, recordJourney } from "../lib/record-journey.js";
import { useInvalidate } from "../lib/queries.js";

/** Something of the player is on record: a profile, or a battle. */
const recorded = (player) =>
  hasBattleEvidence(player) || player.profile_available === true;

/**
 * Home's first read, whichever view the page is drawing (2026-11-09).
 *
 * A battle on record is not the first read: a tag Elixir already knew as an
 * opponent arrives with that battle (from someone else's log), and a profile
 * lands seconds before the log, so either one drew Today with "Battle log read:
 * never" and nothing read again. The wait ends when the player's own battle
 * log has been read, or when the fast window after the add (useFirstAnswer's
 * three minutes) is over; a read that failed or a tag the game does not know
 * ends it too, and the steps say so.
 *
 * One status read polls (useFirstAnswer: every 5 s for three minutes after
 * the add, then once a minute), and only while the log is unread or nothing is
 * on record: an account whose player's log has been read polls nothing. When
 * the read lands on an open page, Home's reads refresh once and
 * `home.first_read_landed` is counted once (#508).
 */
export function useFirstRead(first) {
  const invalidate = useInvalidate();
  const head = first?.player ?? null;
  const answer = useFirstAnswer(head?.player_tag ?? "none", {
    enabled: Boolean(head) && (!logRead(head) || !recorded(head)),
  });
  // The status read is the newer one until Home's own read catches up: the log
  // read and something on record. A log read that lands before the profile
  // (an empty log) leaves Home's read incomplete, so later status reads still
  // win (Codex on #741).
  const incomplete = Boolean(head) && (!logRead(head) || !recorded(head));
  const live = answer.data && incomplete ? answer.data : first;
  const player = live?.player ?? null;
  // The fast window, on the server's clock: each status read says when it was
  // read (`as_of`), so the wait ends with the first answer past it.
  const since = Date.parse(player?.tracked_since ?? "");
  const asOf = Date.parse(live?.as_of ?? "");
  const windowOver = !(asOf - since < FAST_WINDOW_MS);
  const journey = recordJourney(live);
  const waiting = Boolean(
    player &&
    player.recording_status === "active" &&
    !logRead(player) &&
    !journey.notFound &&
    !journey.failedAt &&
    !windowOver,
  );
  const ready = Boolean(player && recorded(player) && !waiting);
  useFirstReadLanded(
    player,
    useCallback(() => {
      // A count of the moment, once per page, never whose (#508).
      trackEvent("home.first_read_landed");
      invalidate(["me", "home"]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  // The log was read before this page, but the profile lands after it: Home's
  // reads refresh once so Today draws what the status read already shows.
  const caughtUp = useRef(false);
  const landedLater = Boolean(
    head && logRead(head) && !recorded(head) && player && recorded(player),
  );
  useEffect(() => {
    if (!landedLater || caughtUp.current) return;
    caughtUp.current = true;
    invalidate(["me", "home"]);
  }, [landedLater, invalidate]);
  return { answer, live, player, ready, waiting };
}
