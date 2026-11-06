import { useEffect, useState } from "react";
import { SubNav } from "../components/SubNav.jsx";
import { clanPath } from "../lib/base.js";
import { membersPages } from "../lib/tabs.js";

/**
 * Members' row: Roster, Standing, Review and Map as pages, Recruit and Scout
 * to the right of them, and the one roster search. Finding a member is a
 * roster address (`/members?find=`), so it can be sent and survives Back.
 */
export function MembersNav({ me, page, navigate, find, clan }) {
  const { chips, side } = membersPages(me);
  const [text, setText] = useState(find ?? "");
  useEffect(() => setText(find ?? ""), [find]);
  const base = `${clanPath(clan.clan_tag)}/members`;
  return (
    <SubNav
      label="Members"
      items={[...chips, ...side]}
      current={page}
      navigate={navigate}
      aside={
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = text.trim();
            navigate?.(
              q ? `${base}?${new URLSearchParams({ find: q })}` : base,
            );
          }}
        >
          <label className="sr-only" htmlFor="members-find">
            Find a member
          </label>
          <input
            id="members-find"
            className="input clan-subnav__find"
            type="search"
            placeholder="Find a member"
            maxLength={100}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </form>
      }
    />
  );
}
