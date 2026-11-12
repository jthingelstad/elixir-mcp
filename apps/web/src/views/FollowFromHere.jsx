import { Link, Panel, Row, Rows, Tag } from "@elixir-mcp/ui";
import { useFollowCost } from "../lib/queries.js";
import { Followed, followCostLine, useFollow } from "../home/follow.jsx";

/**
 * Follow from a shared post or a battle link (social slice 5, #763).
 *
 * The suggestions come from the page's own content, never from who sent
 * the link ("Invites carry no referral ids"): a post's player first, then
 * the rest of its battle; a battle's left side (the recorded player) first,
 * then the right. Players the reader already holds as their own are left
 * out. Each says what a Follow costs (#760) before the tap, from the same
 * read Home's Follow uses, and the Follow is Home's own. As on Home's
 * Friends, an account with no player of its own is asked for it first
 * (Friends sit beside your own record).
 */
const isOwn = (c) =>
  c.is_primary === true ||
  c.relationship === "primary" ||
  c.relationship === "alt";

export function followSuggestions(sides, me, first = null) {
  const own = new Set(
    (me?.claims ?? []).filter(isOwn).map((c) => c.player_tag),
  );
  const seen = new Set();
  const out = [];
  for (const side of sides ?? [])
    for (const p of side?.players ?? []) {
      const tag = p?.player_tag;
      if (!tag || seen.has(tag) || own.has(tag)) continue;
      seen.add(tag);
      out.push({ tag, name: p.name ?? null });
    }
  if (first) {
    const at = out.findIndex((p) => p.tag === first);
    if (at > 0) out.unshift(...out.splice(at, 1));
  }
  return out;
}

export function FollowFromHere({ sides, me, first = null }) {
  const players = followSuggestions(sides, me, first);
  if (players.length === 0) return null;
  if (!(me?.claims ?? []).some(isOwn))
    return (
      <Panel title="Follow from here" aria-label="Follow from here">
        <div className="kit-panel__body">
          <p className="text-[14px] text-ink-body">
            Add your own player first. Friends sit beside your own record, so
            Elixir needs to know who you are before you follow anyone; then come
            back to this page.
          </p>
          <Link to="/home" className="btn btn--sm mt-3">
            Add your player
          </Link>
        </div>
      </Panel>
    );
  return (
    <Panel title="Follow from here" aria-label="Follow from here">
      <Rows>
        {players.map((p) => (
          <Suggestion key={p.tag} player={p} />
        ))}
      </Rows>
    </Panel>
  );
}

function Suggestion({ player }) {
  const { data } = useFollowCost(player.tag);
  const { follow, busy, error, result } = useFollow();
  const cost = data && data.player_tag === player.tag ? data : null;
  const following = cost?.following === true || Boolean(result);
  const full =
    cost && !cost.free && cost.limit != null && cost.used >= cost.limit;
  return (
    <>
      <Row
        title={player.name ?? <Tag tag={player.tag} />}
        detail={
          <>
            {player.name ? <Tag tag={player.tag} /> : null}
            {cost && !following ? (
              <span className="kit-tiny block" role="status">
                {followCostLine(cost)}
              </span>
            ) : null}
          </>
        }
        right={
          following ? (
            <span className="kit-tiny">Following</span>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy || full}
              aria-label={`Follow ${player.name ?? player.tag}`}
              onClick={() => follow(player.tag)}
            >
              {busy ? "Following…" : "Follow"}
            </button>
          )
        }
      />
      {error ? (
        <p className="field-error kit-panel__body" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="kit-panel__body">
          <Followed result={result} />
        </div>
      ) : null}
    </>
  );
}
