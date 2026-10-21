import { Icon, RailSwitcher, Tag } from "@elixir-mcp/ui";
import { useState } from "react";
import { CLAN } from "../lib/base.js";
import { landingPath } from "../lib/landing.js";
import { RoleChip } from "./RoleChip.jsx";

/**
 * The Clan picker, at the head of the rail. Jamie, 2026-10-20: "the
 * "Clans" picker in the left rail should go away and it should be a
 * "Clan Picker" that is at the top of the rail similar to what Console
 * has for switching accounts and Ladder has for switching players."
 *
 * The face is the clan you are in: its name, its tag, your role there
 * and, while your player there is not verified, "unverified". Open, it
 * lists each of your clans (name, tag, the player you are there, your
 * role) and ends with the chooser. With one clan there is nothing to
 * open.
 *
 * Each clan is a link to its landing. A plain click remembers the clan
 * first, the way the chooser does, and then goes straight to where the
 * answer says it lands (Actions waiting for a leader, else the roster),
 * so no redirect follows the pick. A modified click opens the clan's
 * own address, where the gate does the same.
 */
export function ClanPicker({ me, navigate, select, selecting }) {
  const here = me.selected;
  const [picking, setPicking] = useState(null);
  const opening = selecting
    ? (me.clans.find((c) => c.clan_tag === picking) ?? null)
    : null;
  const name = here.name ?? here.clan_tag;
  return (
    <RailSwitcher
      head
      id="rail-clans"
      title={`${name}: switch clan`}
      face={<Face clan={here} opening={opening} />}
      choices={me.clans.map((c) => ({
        key: c.clan_tag,
        to: landingPath(me, c.clan_tag),
        body: <Entry clan={c} />,
        end: <RoleChip role={c.role} label={c.role_label} />,
      }))}
      current={here.clan_tag}
      manage={{ label: "All your clans…", to: `${CLAN}/clans` }}
      navigate={navigate}
      choose={async (choice) => {
        if (choice.key === here.clan_tag) return navigate(choice.to);
        setPicking(choice.key);
        try {
          await select(choice.key);
        } finally {
          setPicking(null);
        }
      }}
    />
  );
}

/** The head: the clan, its tag, your role, and whether your player there
 *  is verified; "opening" while another is being picked. */
function Face({ clan, opening }) {
  return (
    <>
      <span className="rail__switch-mark" aria-hidden="true">
        <Icon name="shield" size={17} />
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate text-[13.5px] font-semibold text-ink">
          {clan.name ?? <Tag tag={clan.clan_tag} />}
        </span>
        <span className="rail__switch-line">
          {opening ? (
            <span>
              Opening {opening.name ?? <Tag tag={opening.clan_tag} />}…
            </span>
          ) : (
            <>
              <span className="mono">{clan.clan_tag}</span>
              <RoleChip role={clan.role} label={clan.role_label} />
              {clan.verified === false ? (
                <span className="chip chip--warn">unverified</span>
              ) : null}
            </>
          )}
        </span>
      </span>
    </>
  );
}

/** One clan in the open list: its name, then its tag and the player you
 *  are there. */
function Entry({ clan }) {
  const you = clan.acting_as_name ?? clan.player_name;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-semibold">
        {clan.name ?? <Tag tag={clan.clan_tag} />}
      </span>
      <span className="truncate text-[12px] text-ink-faint">
        <span className="mono">{clan.clan_tag}</span>
        {you ? (
          <>
            {" · "}
            <span className="yours">★</span> {you}
          </>
        ) : null}
        {clan.verified === false ? " · unverified" : null}
      </span>
    </span>
  );
}
