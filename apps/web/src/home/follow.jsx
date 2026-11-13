import { useEffect, useState } from "react";
import { ConfirmAction, Tag } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useFollowCost, useFollowPlan, useInvalidate } from "../lib/queries.js";

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
        tag, or stop following on Players &amp; following. Elixir asks the game
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
    // A debounce, cleared on every keystroke and on unmount (the search
    // sheet's own pattern).
    const settle = () => setSettled(plausible(raw));
    const timer = setTimeout(settle, ms);
    return () => clearTimeout(timer);
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

/**
 * Follow, asked first (#764: "Follow from the page always asks first and shows
 * its cost"). One dialog: who, that they are not told, and what it costs, from
 * the same read as every other Follow. A follow that would take a slot when
 * none is left is not offered; the server refuses it anyway. `cost` is the
 * price when the list read it already: `{ free, following, used, limit }`.
 */
export function FollowButton({
  tag,
  name = null,
  onDone,
  label = "Follow",
  cost: known = null,
  className = "btn btn--sm btn--primary",
}) {
  // A list that priced its people already (People to follow, Find) passes
  // the price in, so a list of thirty is not thirty reads.
  const { data } = useFollowCost(known ? null : tag);
  const invalidate = useInvalidate();
  const cost = known ?? (data && data.player_tag === tag ? data : null);
  const full = Boolean(
    cost && !cost.free && cost.limit != null && cost.used >= cost.limit,
  );
  const who = name ?? tag;
  return (
    <ConfirmAction
      label={label}
      className={className}
      danger={false}
      title={`Follow ${who}?`}
      body={
        <>
          <p className="m-0">
            {name ? (
              <>
                {name} <Tag tag={tag} />
              </>
            ) : (
              <Tag tag={tag} />
            )}
            . They are not told. Their sessions start in your feed.
          </p>
          <p className="kit-tiny" role="status">
            {cost
              ? (followCostLine(cost) ?? "You already follow them.")
              : "Checking what this costs…"}
          </p>
        </>
      }
      confirm="Follow"
      disabled={full}
      run={() => api.claimAction({ player_tag: tag, relationship: "friend" })}
      onDone={(answer) => {
        invalidate();
        onDone?.(answer?.data ?? null);
      }}
    />
  );
}

/** A follow plan in words (#764): how many to follow, how many are free and
 *  how many take a slot, against the slots left; or why it cannot go. */
export function followPlanLine(plan) {
  if (!plan) return null;
  const line = planLine(plan);
  // Your own players are in the list a clan names, and never followed.
  const own = plan.yours?.length ?? 0;
  if (!own) return line;
  return `${line}${line.endsWith(".") ? "" : "."} ${own === 1 ? "Your own player is" : "Your own players are"} left out.`;
}

function planLine(plan) {
  const n = (v) => v.toLocaleString();
  const many = (k, one, other) => `${n(k)} ${k === 1 ? one : other}`;
  if (plan.to_follow === 0)
    return plan.following > 0
      ? "You already follow every one of them."
      : "Nobody here to follow.";
  const parts = [
    `${many(plan.to_follow, "player", "players")} to follow`,
    `${n(plan.free)} free`,
    `${many(plan.slots, "uses a slot", "use a slot")}`,
  ];
  const head = parts.join(" · ");
  if (plan.limit == null) return head;
  const left = Math.max(0, plan.limit - plan.used);
  if (!plan.fits)
    return `${head}. Only ${n(left)} of your ${n(plan.limit)} player slots are left, so nobody would be followed. Following a player Elixir already records stays free.`;
  return `${head} · ${n(plan.used)} of ${n(plan.limit)} slots used now`;
}

/**
 * Follow everyone a list names, in one confirmed act (#764): a clan's current
 * members, or a Follow me link's players. Priced before the tap, refused whole
 * past the limit, never in part.
 */
export function FollowAll({ ask, label, title, onDone }) {
  const plan = useFollowPlan(ask);
  const invalidate = useInvalidate();
  const p = plan.data ?? null;
  return (
    <ConfirmAction
      label={label}
      className="btn btn--sm"
      danger={false}
      title={title}
      body={
        <>
          <p className="m-0">
            Nobody is told. Their sessions start in your feed, and you can stop
            following anyone on Players &amp; following.
          </p>
          <p className="kit-tiny" role="status">
            {p
              ? followPlanLine(p)
              : plan.isError
                ? "What this costs could not be read just now."
                : "Checking what this costs…"}
          </p>
        </>
      }
      confirm="Follow everyone"
      disabled={!p || !p.fits || p.to_follow === 0}
      run={() => api.followAll(ask)}
      onDone={(answer) => {
        invalidate();
        onDone?.(answer?.data ?? null);
      }}
    />
  );
}
