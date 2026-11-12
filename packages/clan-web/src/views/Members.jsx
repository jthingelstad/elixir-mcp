import { useEffect, useState } from "react";
import { clanPath } from "../lib/base.js";

/**
 * Members has no row of pages since G6 (2026-11-12): the roster is the page,
 * with the Map and Away under it. These are its two small parts.
 */

/** The one roster search. Finding a member is a roster address
 *  (`/members?find=`), so it can be sent and survives Back. */
export function MembersFind({ navigate, find, clan }) {
  const [text, setText] = useState(find ?? "");
  useEffect(() => setText(find ?? ""), [find]);
  const base = `${clanPath(clan.clan_tag)}/members`;
  return (
    <form
      role="search"
      className="clan-members-find"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        navigate?.(q ? `${base}?${new URLSearchParams({ find: q })}` : base);
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
  );
}

/** A page under Members goes back to the roster. */
export function MembersBack({ clan, navigate }) {
  const to = `${clanPath(clan.clan_tag)}/members`;
  return (
    <a
      className="clan-members-back"
      href={to}
      onClick={(e) => {
        if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      ‹ Members
    </a>
  );
}
