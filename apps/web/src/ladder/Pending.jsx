import { Link } from "@elixir-mcp/ui";
import { useEffect, useRef } from "react";
import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { CONSOLE } from "../lib/console.js";
import { useInvalidate } from "../lib/queries.js";
import { recordJourney } from "../lib/record-journey.js";
import { tagPath } from "../lib/tag-url.js";
import { captureLanded, playerName } from "./ladder.js";

/**
 * The first capture is on its way (2026-10-08). A player just added has
 * nothing on record, so instead of a red read error or "no battles in
 * this mode", Ladder says what is happening and links to the capture
 * status. The one Ladder view that polls: it reads the Console's
 * first-answer status (an account read, never a tool, so it costs the
 * reader no quota) as FirstAnswer does: every few seconds for the first
 * minutes after the add, then about once a minute, and when
 * the capture has landed (captureLanded: the profile and a battle-log
 * read) it refreshes the Ladder reads once.
 */
export function Pending({ player }) {
  const tag = player.player_tag;
  const { data } = useFirstAnswer(tag, { playerTag: tag });
  const invalidate = useInvalidate();
  const p = data?.player;
  const landed = captureLanded(p);
  const refreshed = useRef(false);
  useEffect(() => {
    if (!landed || refreshed.current) return;
    refreshed.current = true;
    invalidate(["me", "ladder"]);
  }, [landed, invalidate]);
  const journey = data ? recordJourney(data) : null;
  const status = `${CONSOLE}/account/tracking/${tagPath(tag)}`;
  if (journey?.notFound)
    return (
      <div className="empty mt-6" role="alert">
        <h1 className="empty__title">Tag not found</h1>
        <p className="empty__body">{journey.text}</p>
        <Link className="btn btn--sm" to={`${status}#fix-tag`}>
          Fix the tag ›
        </Link>
      </div>
    );
  return (
    <div className="empty mt-6">
      <h1 className="empty__title">Your first capture is on its way</h1>
      <p className="empty__body" role="status">
        Elixir has saved {playerName(player)}&rsquo;s tag. The first capture
        usually lands within a few minutes, and roughly the last 30 battles
        arrive with it. This page checks again every few seconds at first, then
        about once a minute.
      </p>
      <Link className="btn btn--sm" to={status}>
        Capture status ›
      </Link>
    </div>
  );
}
