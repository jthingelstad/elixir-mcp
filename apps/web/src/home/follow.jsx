import { useState } from "react";
import { Tag } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useInvalidate } from "../lib/queries.js";

const BAD_TAG =
  "That doesn't look like a player tag. Tags use only these characters: 0 2 8 9 C G J L P Q R U V Y.";

/** One Follow, wherever it is asked for: Home's form and the search sheet's
 *  miss. An explicit act that adds a friend; a keystroke never reaches it. */
export function useFollow() {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const follow = async (tag) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setResult(null);
    const res = await api.claimAction({
      player_tag: tag,
      relationship: "friend",
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.data?.error === "invalid_tag"
          ? BAD_TAG
          : (res.data?.message ?? "That did not work. Try again."),
      );
      return false;
    }
    setResult(res.data);
    invalidate();
    return true;
  };
  return { follow, busy, error, result };
}

/** What a Follow came to, in the words of Home's. */
export function Followed({ result }) {
  const tag = result.player_tag;
  if (result.relationship === "primary" || result.relationship === "alt")
    // [engineering, 2026-11-05]: no board draws a tag that is already yours.
    return <p className="kit-tiny">That player is already yours.</p>;
  if (result.not_found)
    return (
      <p className="kit-tiny" role="status">
        We couldn&rsquo;t find <Tag tag={tag} /> in Clash Royale. Correct the
        tag, or stop following on Players &amp; tracking. Elixir asks the game
        again in about a day, in case the tag is brand new.
      </p>
    );
  if (result.added && result.first_read === false)
    return (
      <p className="kit-tiny" role="status">
        <Tag tag={tag} /> Elixir could not check just now. It will try again.
      </p>
    );
  return (
    <p className="kit-tiny" role="status">
      <Tag tag={tag} /> <b>Recording</b>. Their profile and roughly their last
      30 battles usually arrive within a minute; at busy times it can take a
      few. You can close this page.
    </p>
  );
}
