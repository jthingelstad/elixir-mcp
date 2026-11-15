import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  Avatar,
  Empty,
  ErrorState,
  Icon,
  Link,
  PLAYER_STATE_LABEL,
  PageHead,
  PlayerName,
  TagText,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { trackEvent } from "../analytics.js";
import { accountIdOf } from "../lib/account.js";
import { playerHref } from "../lib/player.js";
import { useAccountPage, useInvalidate } from "../lib/queries.js";
import { ItemList } from "./Player.jsx";
import { PassportRow } from "./PassportRow.jsx";

/**
 * An account's page (Jamie, 2026-11-15): /home/account/<id>, for any
 * signed-in member. An account is a person on Elixir; it says which players
 * it is. Its page shows those players, primary first then alts, each
 * Verified (proved, so nobody else can claim it) or Claimed (said, not
 * proved); its badges; its place at city level; its Stamps; and one
 * timeline of all its players and its own news. Following an account brings
 * that news to your feed, and takes no follow slot.
 *
 * Never an email, a Discord username, a nickname or an agent: what DECISIONS
 * "What is public about an account" makes public and nothing past it.
 */
export function AccountPage() {
  const { pathname } = useLocation();
  const id = accountIdOf(pathname);
  const query = useAccountPage(id);
  if (!id) return <Empty title="That is not an account address" />;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
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

function AccountView({ page }) {
  const a = page.account;
  const primary = a.player;
  const title = primary?.name ?? primary?.tag ?? "An Elixir member";
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
          name={title}
          tag={primary?.tag}
          verified={a.state === "verified"}
          claimed={a.state === "claimed"}
          card={primary?.avatar_card_id ?? null}
          large
        />
        <div className="kit-phead__main">
          <h1 className="kit-phead__name">
            <PlayerName tag={primary?.tag} verified={a.state === "verified"}>
              <TagText>{title}</TagText>
            </PlayerName>
          </h1>
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
              {(a.follows?.count ?? 0).toLocaleString()}
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
          {page.you.self ? null : (
            <FollowAccount id={a.id} following={page.you.following} />
          )}
        </nav>
      </header>
      <section className="kit-account__players" aria-labelledby="acct-players">
        <h2 id="acct-players" className="kit-day__head">
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
          <p className="kit-week__quiet">No players claimed yet.</p>
        )}
      </section>
      <section className="kit-player__body" aria-labelledby="acct-timeline">
        <h2 id="acct-timeline" className="kit-day__head">
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

/** Follow or unfollow an account: free, so one tap, no dialog. */
function FollowAccount({ id, following }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const env = await (
      following ? api.unfollowAccount(id) : api.followAccount(id)
    ).catch(() => null);
    setBusy(false);
    if (!env?.ok) {
      setError(env?.data?.message ?? "That did not work. Try again.");
      return;
    }
    trackEvent(following ? "home.account_unfollowed" : "home.account_followed");
    invalidate();
  };
  return (
    <>
      <button
        type="button"
        className={`btn btn--sm btn--follow${following ? " btn--following" : ""}`}
        aria-pressed={following}
        disabled={busy}
        onClick={run}
      >
        {following ? (
          <>
            <Icon name="check" size={14} /> Following
          </>
        ) : (
          "Follow"
        )}
      </button>
      {error ? (
        <p className="kit-tiny" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
