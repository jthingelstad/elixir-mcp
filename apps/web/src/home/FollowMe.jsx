import { useLocation } from "@tanstack/react-router";
import {
  Empty,
  ErrorState,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tag,
  TagText,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { useFollowPlan } from "../lib/queries.js";
import { playerHref, tagsFromFollowPath } from "../lib/player.js";
import { FollowAll, FollowButton, followCostLine } from "./follow.jsx";

/**
 * A "Follow me in Elixir" link (#764): /home/follow/<tag>,<tag>. It names the
 * players and nothing else (DECISIONS "Invites carry no referral ids"), so
 * this page knows only who to offer, never who sent it.
 *
 * Signed out, Home's shell shows FollowInvite (slice 5's Join, back to this
 * link). Signed in, the players, each with its Follow and what it costs, and
 * one Follow for all of them when there are several.
 */
export function FollowMePage() {
  const { pathname } = useLocation();
  const tags = tagsFromFollowPath(
    pathname.replace(/\/$/, "").split("/")[3] ?? "",
  );
  const { me } = useMe();
  const plan = useFollowPlan(tags ? { player_tags: tags } : null);
  const head = (
    <PageHead
      title="Follow in Elixir"
      sub="Someone shared a link to follow these players."
    />
  );
  if (!tags)
    return (
      <>
        {head}
        <Empty title="This link names no player">
          A Follow me link carries player tags. Check the link you were sent.
        </Empty>
      </>
    );
  const hasOwn = (me?.claims ?? []).some(
    (c) => c.is_primary || ["primary", "alt"].includes(c.relationship),
  );
  if (!hasOwn)
    return (
      <>
        {head}
        <Empty
          title="Add your own player first"
          action={
            <Link to="/home" className="btn btn--sm">
              Add your player
            </Link>
          }
        >
          Friends sit beside your own record, so Elixir needs to know who you
          are before you follow anyone. Then open this link again.
        </Empty>
      </>
    );
  if (plan.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (plan.isError)
    return (
      <>
        {head}
        <ErrorState
          title="These players could not be read just now"
          onRetry={() => plan.refetch()}
          busy={plan.isFetching}
        />
      </>
    );
  const p = plan.data;
  const fresh = p.players.filter((x) => !x.following);
  return (
    <div className="kit-home">
      {head}
      <Panel>
        <Rows>
          {p.players.map((x) => (
            <Row
              key={x.player_tag}
              title={
                <Link to={playerHref(x.player_tag)}>
                  <TagText>{x.name ?? x.player_tag}</TagText>
                </Link>
              }
              detail={
                <>
                  {x.name ? <Tag tag={x.player_tag} /> : null}
                  {!x.following ? (
                    <span className="kit-tiny block">
                      {followCostLine({ ...x, used: p.used, limit: p.limit })}
                    </span>
                  ) : null}
                </>
              }
              right={
                x.following ? (
                  <span className="kit-tiny">Following</span>
                ) : (
                  <FollowButton tag={x.player_tag} name={x.name} />
                )
              }
            />
          ))}
        </Rows>
        {p.yours.length ? (
          <p className="kit-panel__body kit-tiny">
            {p.yours.length === 1
              ? "One of these players is yours."
              : `${p.yours.length} of these players are yours.`}
          </p>
        ) : null}
      </Panel>
      {fresh.length > 1 ? (
        <FollowAll
          ask={{ player_tags: tags }}
          label={`Follow all ${fresh.length}`}
          title={`Follow all ${fresh.length} players?`}
        />
      ) : null}
    </div>
  );
}

/** A Follow me link, signed out: what it is and the way in, back to the link
 *  (slice 5's Join Elixir). */
export function FollowInvite({ returnTo, onSignIn }) {
  const back = encodeURIComponent(returnTo);
  return (
    <section
      className="mx-auto mt-8 max-w-[640px]"
      aria-labelledby="follow-invite"
    >
      <p className="eyebrow">Follow me in Elixir</p>
      <h1 className="hero-title" id="follow-invite">
        Follow these players on Elixir
      </h1>
      <p className="lede">
        Elixir is where Clash Royale players follow each other&rsquo;s battles
        and celebrate them. It&rsquo;s free. Join or sign in and you come back
        to this link, ready to follow.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          className="btn btn--primary"
          href={`/signin?signup&return_to=${back}`}
        >
          Join Elixir
        </a>
        <button type="button" className="btn" onClick={onSignIn}>
          Sign in
        </button>
        <a className="btn btn--quiet" href="/">
          What is Elixir?
        </a>
      </div>
    </section>
  );
}
