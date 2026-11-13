import { useState } from "react";
import {
  FAMILY_PLACES,
  Icon,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tabs,
  TagText,
  useFlash,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { useFollowSlots } from "../lib/queries.js";
import { SETTINGS } from "../lib/settings.js";
import { followMeHref } from "../lib/player.js";
import { BringClanmates } from "../components/BringClanmates.jsx";
import { useSheet } from "../shell/sheet.js";
import { FollowCost, Followed, useFollow } from "./follow.jsx";
import { FromYourBattles, YourClanPeople } from "./People.jsx";

/**
 * Find (slice 7, #765; its sections 2026-11-12): where you go to find people
 * and be found. Your clan lists its members with what following each costs,
 * and Follow my clan, then Bring your clanmates (moved from Stats' Season,
 * Jamie 2026-11-12: "Bring your clanmates moves to Find"); Search opens
 * the sheet every page has, and a tag
 * follows a friend; From your battles lists the players you met; the clan
 * directory lists clans on Elixir; your Follow me link is how a friend finds
 * you. Near you waits on its legal question and is not here, not even as a
 * placeholder.
 */
export const FIND_SECTIONS = [
  { key: "clan", label: "Your clan", own: true },
  { key: "search", label: "Search" },
  { key: "battles", label: "From your battles", own: true },
  { key: "directory", label: "Clan directory" },
  { key: "link", label: "Your link", own: true },
];

/** The sections a reader has: the ones about your own players only when
 *  you have one. */
export const findSections = (hasOwn) =>
  FIND_SECTIONS.filter((t) => hasOwn || !t.own).map(({ key, label }) => ({
    key,
    label,
  }));

export function FindPage() {
  const { me } = useMe();
  const own = (me?.claims ?? []).filter(
    (c) => c.is_primary || c.relationship === "alt",
  );
  const sections = findSections(own.length > 0);
  // Search first: Find is the phone's search, and the old Friends address
  // lands here for its follow form [engineering, 2026-11-12].
  const [tab, setTab] = useState("search");
  return (
    <div className="kit-home">
      <PageHead
        title="Find"
        sub="Find your friends, your clanmates and players you’ve battled."
      />
      <Tabs label="Find" items={sections} value={tab} onSelect={setTab} wrap />
      <div className="kit-home__two">
        <div className="kit-home__main">
          {tab === "clan" ? (
            <>
              <YourClanPeople />
              <BringClanmates />
            </>
          ) : tab === "battles" ? (
            <FromYourBattles />
          ) : tab === "directory" ? (
            <Panel title="Clans">
              <Rows>
                <Row
                  href="/clan/directory"
                  title="Clan directory"
                  detail="Every clan on Elixir, with its open spots."
                />
              </Rows>
            </Panel>
          ) : tab === "link" ? (
            <FollowMeLink players={own} />
          ) : (
            <Search />
          )}
        </div>
        <aside className="kit-home__side" aria-label="Your follow slots">
          <SlotsSide />
        </aside>
      </div>
    </div>
  );
}

/** Find's side (the canvas's "Your follow slots"): how many of your slots
 *  are in use, from the same read as Settings' slots, and the way there. */
function SlotsSide() {
  const q = useFollowSlots();
  const d = q.data ?? null;
  if (!d) return null;
  const n = (v) => Number(v ?? 0).toLocaleString();
  const line =
    d.limit == null
      ? `${n(d.used)} in use, no limit`
      : `${n(d.used)} of ${n(d.limit)} used`;
  return (
    <Panel
      title="Your follow slots"
      action={<span className="kit-tiny">{line}</span>}
      pad
    >
      {d.limit == null ? null : (
        <progress
          className="kit-meter"
          max={d.limit}
          value={Math.min(d.used ?? 0, d.limit)}
          aria-label={`Follow slots: ${line}`}
        />
      )}
      <p className="kit-tiny">
        <Link to={`${SETTINGS}/what-members-see`} className="hit">
          See who uses one
        </Link>
      </p>
    </Panel>
  );
}

/** Search: the sheet every page opens, and a tag to follow. */
function Search() {
  const open = useSheet();
  return (
    <>
      <button
        type="button"
        className="kit-find__search"
        aria-haspopup="dialog"
        onClick={() => open("search")}
      >
        <Icon name={FAMILY_PLACES.search.icon} size={18} />
        <span>{FAMILY_PLACES.search.prompt}</span>
      </button>
      <FollowForm />
    </>
  );
}

/** The Follow form. It posts one relationship and reads back what became of
 *  it: added, already yours, already followed, or not found in the game. A
 *  Follow here makes a Friend (Q10), never your main. */
function FollowForm() {
  const [tag, setTag] = useState("");
  const { follow, busy, error: err, result } = useFollow();
  return (
    <div className="kit-follow">
      <form
        className="kit-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!tag.trim()) return;
          if (await follow(tag.trim())) setTag("");
        }}
      >
        <label htmlFor="find-follow-tag">Follow a friend</label>
        <div className="kit-form__row">
          <input
            id="find-follow-tag"
            className="input"
            placeholder="#TAG"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Follow
          </button>
        </div>
        {err ? (
          <p className="kit-form__err" role="alert">
            {err}
          </p>
        ) : (
          <>
            <FollowCost tag={tag} />
            <p className="kit-tiny">
              Anyone with a player tag can be followed. They aren&rsquo;t told.
              Recording starts at once; the first read usually lands within a
              minute.
            </p>
          </>
        )}
      </form>
      {result ? <Followed result={result} /> : null}
    </div>
  );
}

/** Your "Follow me in Elixir" link: your players' tags and nothing else
 *  (DECISIONS "Invites carry no referral ids"). */
function FollowMeLink({ players }) {
  const [copied, flash] = useFlash();
  const path = followMeHref(players.map((p) => p.player_tag));
  const url =
    typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <Panel title="Your follow link" pad>
      <p className="kit-tiny">
        Send it to a friend: it opens your players&rsquo; page on Elixir, ready
        to follow. It names{" "}
        <TagText>
          {players.map((p) => p.name ?? p.player_tag).join(" and ")}
        </TagText>{" "}
        and nothing else.
      </p>
      <p className="kit-find__link">
        <code>{url}</code>
      </p>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => {
          navigator.clipboard?.writeText(url);
          flash();
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
        {copied ? "Copied" : "Copy your follow link"}
      </button>
    </Panel>
  );
}
