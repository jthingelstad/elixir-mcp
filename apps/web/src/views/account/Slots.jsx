import {
  ConfirmAction,
  ErrorState,
  Link,
  Panel,
  Row,
  Rows,
  TagText,
} from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { useFollowSlots, useInvalidate } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";
import { playerHref } from "../../lib/player.js";
import { tagPath } from "../../lib/tag-url.js";

/**
 * Your follow slots (Settings › What members see, 2026-11-12, the canvas's
 * "Your follow slots"): a meter of the slots in use out of your limit, the
 * players that use one because of you, each with its way to stop, and
 * apart from them the follows that are free because Elixir records the
 * player anyway.
 *
 * Every number is `GET /api/me/follow-slots`, which prices the pool with
 * the one statement every Follow dialog reads (`playerCostSql` in
 * @elixir-mcp/claims): its `used` is the "N used" a Follow says, and the
 * rows that use a slot are exactly that many.
 */

const n = (v) => Number(v ?? 0).toLocaleString();

/** The meter's words, the same as the Follow dialogs' "N of L". */
function slotLine(d) {
  if (!d) return null;
  return d.limit == null
    ? `${n(d.used)} in use, no limit`
    : `${n(d.used)} of ${n(d.limit)} used`;
}

const HOW = {
  primary: "Your main player",
  alt: "Your alt",
  friend: "You follow them",
  watching: "You watch them",
};

const WHY_FREE = {
  in_recorded_clan: "In a clan Elixir records in full",
  followed_by_others: "Another account followed them first",
};

/** Who in your pool follows the player, in words. */
function howFollowed(p) {
  const parts = [];
  if (p.yours) parts.push(HOW[p.yours] ?? "You follow them");
  for (const a of p.agents ?? [])
    parts.push(`Your agent ${a.name ?? a.public_id} follows them`);
  return parts.join(" · ");
}

/** The way to stop a slot-using follow: yours stops here; your own player
 *  is removed on its own page; an agent's is the agent's to drop. */
function Stop({ p }) {
  const invalidate = useInvalidate();
  const who = p.name ?? p.player_tag;
  if (p.yours === "friend" || p.yours === "watching") {
    const still = (p.agents ?? []).length > 0;
    return (
      <ConfirmAction
        label={p.yours === "watching" ? "Stop watching" : "Stop following"}
        title={`Stop following ${who}?`}
        body={
          <p className="m-0">
            Elixir stops recording <TagText>{who}</TagText> for you. They are
            not told.{" "}
            {still
              ? "Your agent still follows them, so they keep using a slot until the agent stops too."
              : "Their slot is free again at once."}
          </p>
        }
        confirm="Stop following"
        run={() =>
          api.claimAction({ player_tag: p.player_tag, action: "remove" })
        }
        onDone={() => invalidate()}
      />
    );
  }
  if (p.yours)
    return (
      <Link
        className="btn btn--sm"
        to={`${SETTINGS}/players/${tagPath(p.player_tag)}`}
      >
        Open
      </Link>
    );
  const agent = (p.agents ?? [])[0];
  return agent ? (
    <Link
      className="btn btn--sm"
      to={`${SETTINGS}/agents/${agent.public_id}/reads`}
    >
      Agent
    </Link>
  ) : null;
}

/** One player: the whole row opens their page (its name's link covers the
 *  row), and its way to stop sits above that, a control of its own. */
function Player({ p, action = null, why = null }) {
  return (
    <Row
      className="kit-row--target"
      title={
        <Link className="kit-row__link" to={playerHref(p.player_tag)}>
          <TagText>{p.name ?? p.player_tag}</TagText>
        </Link>
      }
      detail={[why, howFollowed(p)].filter(Boolean).join(" · ")}
      right={action}
    />
  );
}

export function FollowSlots() {
  const q = useFollowSlots();
  const d = q.data ?? null;
  const line = slotLine(d);
  const using = (d?.players ?? []).filter((p) => p.slot === "used");
  const free = (d?.players ?? []).filter((p) => p.slot === "free");
  return (
    <Panel
      title="Your follow slots"
      titleAs="h2"
      action={line ? <span className="kit-tiny">{line}</span> : null}
    >
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !d ? (
        <p className="st-inset text-ink-faint" role="status">
          Reading your slots.
        </p>
      ) : (
        <>
          <div className="st-inset">
            {d.limit == null ? (
              <p>{line}</p>
            ) : (
              <progress
                className="st-slot-meter"
                max={d.limit}
                value={Math.min(d.used, d.limit)}
                aria-label={`Follow slots: ${line}`}
              />
            )}
          </div>
          <h3 className="st-group">
            Using a slot<span>{n(using.length)}</span>
          </h3>
          {using.length ? (
            <Rows aria-label="Players using a slot">
              {using.map((p) => (
                <Player key={p.player_tag} p={p} action={<Stop p={p} />} />
              ))}
            </Rows>
          ) : (
            <p className="st-inset text-ink-faint">
              None: everyone you follow is recorded anyway.
            </p>
          )}
          <h3 className="st-group">
            Free, recorded anyway<span>{n(free.length)}</span>
          </h3>
          {free.length ? (
            <Rows aria-label="Free follows">
              {free.map((p) => (
                <Player key={p.player_tag} p={p} why={WHY_FREE[p.reason]} />
              ))}
            </Rows>
          ) : (
            <p className="st-inset text-ink-faint">None yet.</p>
          )}
          <p className="st-foot st-inset">
            A slot is a player Elixir records only because you asked. A member
            of a clan Elixir records in full, or a player another account
            followed first, costs nothing, so a clan where everyone follows
            everyone costs the same as one follower. You and your agents share
            these slots. Stop following someone who uses one to free it; if a
            free player&rsquo;s reason goes away, they keep recording and start
            using a slot.
          </p>
        </>
      )}
    </Panel>
  );
}
