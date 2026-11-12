import { useEffect, useState } from "react";
import { Tag } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useFollowCost, useInvalidate } from "../lib/queries.js";

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

const PLAUSIBLE = /^#?[0289PYLQGRJCUVO]{3,12}$/i;

/** The tag as the server will key it, or null while it is not one yet. */
const plausible = (raw) => {
  const t = String(raw ?? "").trim();
  return PLAUSIBLE.test(t)
    ? `#${t.toUpperCase().replace(/^#/, "").replaceAll("O", "0")}`
    : null;
};

/** A typed tag, settled: what the cost read asks about once typing pauses,
 *  so a keystroke never becomes a request. */
function useSettled(raw, ms = 350) {
  const [settled, setSettled] = useState(() => plausible(raw));
  useEffect(() => {
    const t = setTimeout(() => setSettled(plausible(raw)), ms);
    return () => clearTimeout(t);
  }, [raw, ms]);
  return settled;
}

/** What a Follow costs, said before the tap (#760): one flat, small line.
 *  A player Elixir already records is free; anyone else takes one of the
 *  account's player slots, shared with its agents. Says nothing until the
 *  tag is plausible and the answer is in, and nothing at all when the
 *  read fails: the tap still works, and its refusal says the same. */
export function FollowCost({ tag }) {
  const settled = useSettled(tag);
  const { data } = useFollowCost(settled);
  if (!settled || !data || data.player_tag !== settled) return null;
  const line = followCostLine(data);
  return line ? (
    <p className="kit-tiny" role="status">
      {line}
    </p>
  ) : null;
}

/** The words, apart so tests can read them without a render. */
export function followCostLine(c) {
  if (c.following) return null;
  const n = (v) => v.toLocaleString();
  if (c.free)
    return c.limit == null
      ? "Free · already recorded"
      : `Free · already recorded · ${n(c.used)} of ${n(c.limit)} slots used`;
  if (c.limit == null) return null;
  if (c.used >= c.limit)
    return `All ${n(c.limit)} player slots in use. Following a player Elixir already records stays free.`;
  return `Uses 1 of your ${n(c.limit)} player slots · ${n(c.used)} used`;
}
