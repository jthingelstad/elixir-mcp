import { Icon, Link, Rail } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import {
  LADDER_PAGES,
  ladderHref,
  ladderPlayers,
  pickPlayer,
  playerName,
} from "../lib/ladder.js";

/**
 * Ladder's rail: the kit's, with the player whose season it reads at
 * the head and a line at the foot that says what the section is. The
 * pages carry the player and the mode the address names, so moving
 * between them never changes whose season or which game you are in.
 */
export function LadderRail({ me, search, here, navigate, narrow }) {
  const players = ladderPlayers(me?.claims);
  const player = pickPlayer(players, search.player);
  const keep = { player: search.player, mode: search.mode };
  const items = LADDER_PAGES.map((p) => ({
    key: p.slug,
    label: p.label,
    icon: p.icon,
    to: ladderHref(p.slug, keep),
  }));
  return (
    <Rail
      label="Ladder sections"
      items={items}
      current={here.key}
      navigate={navigate}
      narrow={narrow}
      title="Ladder"
      head={
        player ? (
          <PlayerSwitcher
            players={players}
            current={player}
            hrefFor={(p) =>
              ladderHref(here.key, {
                player: p.is_primary ? undefined : p.player_tag,
                mode: search.mode,
              })
            }
            navigate={navigate}
          />
        ) : undefined
      }
      identity={
        <p className="ladder-rail__note">
          A mirror, not a coach: your record, read back.
        </p>
      }
    />
  );
}

/** Whose season this is: the player's name and tag, a star on the
 *  primary, and the others a click away when there are any. A list of
 *  links, like the console's account selector: choosing one is going to
 *  that player's address, not a setting the page remembers. */
function PlayerSwitcher({ players, current, hrefFor, navigate }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const many = players.length > 1;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const face = (
    <>
      <span className="ladder-player__mark">
        <Icon name={current.is_primary ? "star" : "user-round"} size={16} />
      </span>
      <span className="flex min-w-0 flex-auto flex-col">
        <span className="truncate text-[14px] font-semibold">
          {playerName(current)}
        </span>
        <span className="mono text-[11.5px] text-ink-faint">
          {current.player_tag}
        </span>
      </span>
    </>
  );

  if (!many)
    return (
      <div className="rail__switch ladder-player">
        <div className="ladder-player__head">{face}</div>
      </div>
    );

  return (
    <div className="rail__switch ladder-player" ref={box}>
      <button
        type="button"
        className="ladder-player__head"
        aria-expanded={open}
        aria-controls="ladder-players"
        title={`Ladder: ${playerName(current)}. Switch player`}
        onClick={() => setOpen(!open)}
      >
        {face}
        <Icon name="chevrons-up-down" size={16} />
      </button>
      {open && (
        <div id="ladder-players" className="rail__switch-list">
          {players.map((p) => {
            const to = hrefFor(p);
            return (
              <Link
                key={p.player_tag}
                to={to}
                navigate={navigate}
                className="rail__switch-item"
                aria-current={
                  p.player_tag === current.player_tag ? "true" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">
                    {playerName(p)}
                  </span>
                  <span className="mono truncate text-[12px] text-ink-faint">
                    {p.player_tag}
                  </span>
                </span>
                <span className="mono ml-auto shrink-0 text-[12px] text-ink-faint">
                  {p.is_primary ? "primary" : "alt"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
