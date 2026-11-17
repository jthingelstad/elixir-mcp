import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  Avatar,
  ConfirmAction,
  Empty,
  ErrorState,
  Icon,
  Link,
  PLAYER_STATE_LABEL,
  PageHead,
  PlayerName,
  TagText,
  Skeleton,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { trackEvent } from "../analytics.js";
import { accountIdOf } from "../lib/account.js";
import { playerHref } from "../lib/player.js";
import { useAccountPage, useInvalidate } from "../lib/queries.js";
import { ItemList } from "./Player.jsx";
import { PassportRow } from "./PassportRow.jsx";
import { followPlanLine } from "./follow.jsx";

/**
 * An account's page (Jamie, 2026-11-15): /home/account/<id>, or
 * /home/@handle when the account set one, for any signed-in member. An account is a person on Elixir; it says which players
 * it is. Its page shows those players, primary first then alts, each
 * Verified (proved, so nobody else can claim it) or Claimed (said, not
 * proved); its badges; its place at city level; its Stamps; and one
 * timeline of all its players and its own news. Following an account brings
 * that news to your feed and follows each player it has verified.
 *
 * Never an email, a Discord username, a nickname or an agent: what DECISIONS
 * "What is public about an account" makes public and nothing past it.
 */
export function AccountPage() {
  const { pathname } = useLocation();
  const id = accountIdOf(pathname);
  const query = useAccountPage(id);
  if (!id) return <Empty title="That is not an account address" />;
  if (query.isPending) return <Skeleton shape="profile" />;
  if (query.isError || (query.data && query.data.status >= 500))
    return (
      <ErrorState
        title="This account could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  const env = query.data;
  if (env.status === 404)
    return (
      <>
        <PageHead title="Account" />
        <Empty title="No Elixir account at this address">
          The link may be mistyped, or the account is gone.
        </Empty>
      </>
    );
  if (env.status === 429)
    return (
      <Empty title="Elixir is busy for you just now">
        {env.data?.message ?? "Try again in a little while."}
      </Empty>
    );
  return <AccountView page={env.data} />;
}

const placeWords = (place) =>
  place
    ? [place.city, place.region, place.country].filter(Boolean).join(", ")
    : null;

/**
 * The page itself, for AccountPage and for You (2026-11-15: You opens your
 * own account page). `actions` is what the header offers yourself (You's
 * Your stats); `noPlayers` replaces the empty Players line.
 *
 * An account with an @handle (2026-11-15) leads with it, its main player
 * under it; one without leads with its main player, as before.
 */
export function AccountView({ page, actions = null, noPlayers = null }) {
  const a = page.account;
  const primary = a.player;
  const playerName = primary?.name ?? primary?.tag ?? "An Elixir member";
  const title = a.handle ? `@${a.handle}` : playerName;
  const place = placeWords(a.place);
  const sub = [
    primary?.tag,
    place,
    a.state ? PLAYER_STATE_LABEL[a.state] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="kit-home kit-player kit-account">
      <header className="kit-phead">
        <Avatar
          name={playerName}
          tag={primary?.tag}
          verified={a.state === "verified"}
          claimed={a.state === "claimed"}
          card={primary?.avatar_card_id ?? null}
          large
        />
        <div className="kit-phead__main">
          {a.handle ? (
            <>
              <h1 className="kit-phead__name">{title}</h1>
              {primary ? (
                <p className="kit-phead__line">
                  <PlayerName
                    tag={primary.tag}
                    verified={a.state === "verified"}
                  >
                    <TagText>{playerName}</TagText>
                  </PlayerName>
                </p>
              ) : null}
            </>
          ) : (
            <h1 className="kit-phead__name">
              <PlayerName tag={primary?.tag} verified={a.state === "verified"}>
                <TagText>{title}</TagText>
              </PlayerName>
            </h1>
          )}
          {sub ? (
            <p className="kit-phead__line">
              <TagText>{sub}</TagText>
            </p>
          ) : null}
          <AccountBadges badges={a.badges} />
          {page.passport ? (
            <PassportRow summary={page.passport} own={page.you.self} />
          ) : null}
        </div>
        <div className="kit-statrow">
          <span className="kit-stat">
            <span className="kit-stat__label">Following</span>{" "}
            <span className="kit-stat__value">
              {(
                (a.follows?.count ?? 0) + (a.following_accounts ?? 0)
              ).toLocaleString()}
            </span>
          </span>
          <span className="kit-stat">
            <span className="kit-stat__label">Followers</span>{" "}
            <span className="kit-stat__value">
              {(a.followers ?? 0).toLocaleString()}
            </span>
          </span>
        </div>
        <nav className="kit-phead__actions" aria-label="This account">
          {page.you.self ? (
            actions
          ) : (
            <FollowAccount
              id={a.id}
              following={page.you.following}
              plan={page.you.plan ?? null}
            />
          )}
        </nav>
      </header>
      <section className="kit-account__players" aria-labelledby="acct-players">
        <h2 id="acct-players" className="kit-account__head">
          Players
        </h2>
        {a.players.length ? (
          <ul className="kit-account__list">
            {a.players.map((p) => (
              <li key={p.tag} className="kit-account__player">
                <Avatar
                  name={p.name ?? p.tag}
                  tag={p.tag}
                  verified={p.state === "verified"}
                  claimed={p.state === "claimed"}
                  card={p.avatar_card_id ?? null}
                  small
                />
                <Link to={playerHref(p.tag)} className="kit-account__name">
                  <PlayerName tag={p.tag} verified={p.state === "verified"}>
                    <TagText>{p.name ?? p.tag}</TagText>
                  </PlayerName>
                </Link>
                <span className="kit-tiny">
                  {p.relationship === "primary" ? "Main" : "Alt"} ·{" "}
                  {PLAYER_STATE_LABEL[p.state]}
                  {p.clan_name ? (
                    <>
                      {" · "}
                      <TagText>{p.clan_name}</TagText>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          (noPlayers ?? (
            <p className="kit-week__quiet">No players claimed yet.</p>
          ))
        )}
      </section>
      <section className="kit-player__body" aria-labelledby="acct-timeline">
        <h2 id="acct-timeline" className="kit-account__head">
          Timeline
        </h2>
        <ItemList
          items={page.timeline}
          empty={`Nothing in the last ${page.window_days} days.`}
          more={page.timeline_more}
          accountLinks={false}
        />
      </section>
    </div>
  );
}

/** That the account verified a player, and that it linked a Discord,
 *  never which. */
function AccountBadges({ badges }) {
  if (!badges?.verified_player && !badges?.discord) return null;
  return (
    <p className="kit-player__badges">
      {badges.verified_player ? (
        <span className="kit-badge kit-badge--ok">
          <Icon name="check" size={12} /> Verified player
        </span>
      ) : null}
      {badges.discord ? (
        <span className="kit-badge">Verified in Discord</span>
      ) : null}
    </p>
  );
}

/**
 * Follow or unfollow an account, asked first (linked follows, Jamie
 * 2026-11-15): following an account follows each player it has verified,
 * now and later, so the dialog prices those players as a Follow of a clan
 * does. Stopping ends it all: the account and its Verified players.
 */
function FollowAccount({ id, following, plan }) {
  const invalidate = useInvalidate();
  const [result, setResult] = useState(null);
  const done = (kind) => (answer) => {
    trackEvent(kind);
    setResult(answer?.data ?? null);
    invalidate();
  };
  if (following)
    return (
      <>
        <ConfirmAction
          label={
            <>
              <Icon name="check" size={14} /> Following
            </>
          }
          className="btn btn--sm btn--follow btn--following"
          title="Stop following this account?"
          body={
            <p className="m-0">
              You&rsquo;ll stop following their account and every player
              they&rsquo;ve verified. Their news leaves your feed.
            </p>
          }
          confirm="Stop following"
          run={() => api.unfollowAccount(id)}
          onDone={done("home.account_unfollowed")}
        />
        <FollowResult result={result} />
      </>
    );
  return (
    <>
      <ConfirmAction
        label="Follow"
        className="btn btn--sm btn--follow"
        danger={false}
        title="Follow this account?"
        body={
          <>
            <p className="m-0">
              You&rsquo;ll follow their account and every player they&rsquo;ve
              verified, now and later. Their bell shows a new follower.
            </p>
            <p className="kit-tiny" role="status">
              {plan
                ? plan.to_follow === 0
                  ? "No players to add · free"
                  : followPlanLine(plan)
                : "Free · no player slots"}
            </p>
          </>
        }
        confirm="Follow"
        run={() => api.followAccount(id)}
        onDone={done("home.account_followed")}
      />
      <FollowResult result={result} />
    </>
  );
}

/** What the last Follow came to, when a player could not be taken. */
function FollowResult({ result }) {
  const skipped = result?.skipped?.length ?? 0;
  if (!skipped) return null;
  return (
    <p className="kit-tiny" role="status">
      {skipped === 1 ? "1 player wasn’t" : `${skipped} players weren’t`}{" "}
      followed: no free player slot, or no player of your own yet. Your bell has
      the details.
    </p>
  );
}
