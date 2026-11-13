import { Link, PageHead, TagText, Empty } from "@elixir-mcp/ui";
import { useEffect, useRef } from "react";
import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { SETTINGS } from "../lib/settings.js";
import { useInvalidate } from "../lib/queries.js";
import { recordJourney } from "../lib/record-journey.js";
import { tagPath } from "../lib/tag-url.js";
import { captureLanded, playerName } from "./ladder.js";
import { PlayerPick } from "./ScopeBar.jsx";

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
export function Pending({ player, players, hrefFor, navigate }) {
  const tag = player.player_tag;
  const { data, error } = useFirstAnswer(tag, { playerTag: tag });
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
  const status = `${SETTINGS}/players/${tagPath(tag)}`;
  const name = playerName(player);
  return (
    <div className="ladder-page">
      <PageHead
        className="ladder-head"
        title="Stats"
        sub="Your season, read back"
      />
      <div className="ladder-scope">
        <div className="ladder-scope__picks">
          <PlayerPick
            player={player}
            players={players}
            hrefFor={hrefFor}
            navigate={navigate}
          />
        </div>
      </div>
      {journey?.notFound ? (
        <Empty
          title="Tag not found"
          titleAs="h2"
          action={
            <Link className="btn btn--sm" to={`${status}#fix-tag`}>
              Fix the tag ›
            </Link>
          }
          role="alert"
        >
          <TagText>{journey.text}</TagText>
        </Empty>
      ) : (
        <Empty
          title={<>{name}&rsquo;s first battles are on their way</>}
          titleAs="h2"
          action={
            <Link className="btn btn--sm" to={status}>
              See recording status ›
            </Link>
          }
          role="status"
        >
          {name}&rsquo;s tag is saved. The profile and about the last 30 battles
          usually show up within a minute (a few at busy times). This page
          checks again every few seconds at first, then about once a minute.
          {error ? " Elixir could not check just now. It will try again." : ""}
        </Empty>
      )}
    </div>
  );
}
