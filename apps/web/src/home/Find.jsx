import { useState } from "react";
import {
  FAMILY_PLACES,
  Icon,
  PageHead,
  Panel,
  Row,
  Rows,
  TagText,
  useFlash,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { followMeHref } from "../lib/player.js";
import { useSheet } from "../shell/sheet.js";
import { FollowCost, Followed, useFollow } from "./follow.jsx";

/**
 * Find (slice 7, #765): where you go to find people and be found. Search
 * opens the sheet every page has; a tag follows a friend; the clan
 * directory lists clans on Elixir; your Follow me link is how a friend
 * finds you. Near you waits on its legal question and is not here.
 */
export function FindPage() {
  const { me } = useMe();
  const open = useSheet();
  const own = (me?.claims ?? []).filter(
    (c) => c.is_primary || c.relationship === "alt",
  );
  return (
    <div className="kit-home kit-home--read">
      <PageHead title="Find" sub="People to follow, and the way to you." />
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
      <Panel title="Clans">
        <Rows>
          <Row
            href="/clan/directory"
            title="Clan directory"
            detail="Every clan on Elixir, by name, with its open seats."
          />
        </Rows>
      </Panel>
      {own.length > 0 ? <FollowMeLink players={own} /> : null}
    </div>
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
