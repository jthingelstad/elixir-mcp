import {
  Empty,
  Link,
  Panel,
  Row,
  Rows,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { playerHref } from "../lib/player.js";
import { usePeople } from "../lib/queries.js";
import { FollowAll, FollowButton, followPlanLine } from "./follow.jsx";
import { costMark, metLine, slotsLine, whyLines } from "./logic.js";

/**
 * People to follow (2026-11-12): Home's side panel and Find's From your
 * battles and Your clan. Each person by game name and tag (never a
 * nickname), why they are here as a fact, and what following them costs.
 * Never ranked by skill: the server orders by the facts it states.
 */

/** A person's Follow, priced from the list's own read. */
const priced = (p, used, limit) => ({
  player_tag: p.tag ?? p.player_tag,
  following: Boolean(p.following),
  free: Boolean(p.free),
  reason: p.reason ?? null,
  used,
  limit,
});

function Person({ p, detail, used, limit }) {
  const tag = p.tag ?? p.player_tag;
  return (
    <Row
      className="kit-people__row"
      title={
        <Link to={playerHref(tag)}>
          <TagText>{p.name ?? tag}</TagText>
        </Link>
      }
      detail={detail}
      right={
        p.following ? (
          <span className="kit-tiny">Following</span>
        ) : (
          <FollowButton
            tag={tag}
            name={p.name ?? null}
            cost={priced(p, used, limit)}
          />
        )
      }
    />
  );
}

/** Home's side panel: a few people, each with why and what it costs. It reads
 *  for itself, after the feed, so Home's first paint never waits on it. */
export function PeopleToFollow() {
  const query = usePeople("suggested");
  const data = query.data;
  if (query.isPending)
    return (
      <Panel title="People to follow" pad>
        <div className="kit-skeleton" aria-busy="true" />
      </Panel>
    );
  // A slow or failed read never fails the page: the panel says so and
  // offers to read again (#649).
  if (query.isError || !data?.ok)
    return (
      <Panel title="People to follow" pad>
        <p className="kit-week__quiet">
          Suggestions could not be read just now.{" "}
          <Link to="/home/find">Find people</Link>
        </p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-busy={query.isFetching}
        >
          {query.isFetching ? "Reading…" : "Try again"}
        </button>
      </Panel>
    );
  const slots = slotsLine(data.used, data.limit);
  return (
    <Panel
      title="People to follow"
      action={<Link to="/home/find">Find more people</Link>}
    >
      {data.people.length === 0 ? (
        <p className="kit-week__quiet kit-people__quiet">
          Nobody new from your battles, your clan or the players you follow just
          now.
        </p>
      ) : (
        <Rows>
          {data.people.map((p) => (
            <Person
              key={p.tag}
              p={p}
              used={data.used}
              limit={data.limit}
              detail={
                <>
                  <span className="kit-people__why">{whyLines(p.why)}</span>
                  <span className="kit-people__cost">{costMark(p)}</span>
                </>
              }
            />
          ))}
        </Rows>
      )}
      {slots ? <p className="kit-tiny kit-people__slots">{slots}</p> : null}
    </Panel>
  );
}

/** Find's From your battles: everyone your players met in the last month,
 *  how often and how it went, from the log only. */
export function FromYourBattles() {
  const query = usePeople("battles");
  const { when } = useClock();
  const data = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !data?.ok)
    return (
      <Panel pad>
        <p className="kit-week__quiet">
          Your battles could not be read just now. Try again shortly.
        </p>
      </Panel>
    );
  const slots = slotsLine(data.used, data.limit);
  return (
    <Panel title={`From your battle log, last ${data.days} days`}>
      {data.people.length === 0 ? (
        <p className="kit-week__quiet kit-people__quiet">
          Nobody yet: the players you meet in your battles show here.
        </p>
      ) : (
        <Rows>
          {data.people.map((p) => (
            <Person
              key={p.tag}
              p={p}
              used={data.used}
              limit={data.limit}
              detail={
                <>
                  <span className="kit-people__why">{metLine(p, when)}</span>
                  {p.following ? null : (
                    <span className="kit-people__cost">{costMark(p)}</span>
                  )}
                </>
              }
            />
          ))}
        </Rows>
      )}
      <p className="kit-tiny kit-people__slots">
        Facts from the log only: how often you met and how it went. No ratings,
        no guesses.
        {data.more > 0
          ? ` The ${data.people.length} you met most are shown; ${data.more} more are not.`
          : ""}
        {slots ? ` ${slots}.` : ""}
      </p>
    </Panel>
  );
}

/** Find's Your clan: your player's clan now, everyone in it with what
 *  following them costs, and Follow my clan. */
export function YourClanPeople() {
  const query = usePeople("clan");
  const data = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !data?.ok)
    return (
      <Panel pad>
        <p className="kit-week__quiet">
          Your clan could not be read just now. Try again shortly.
        </p>
      </Panel>
    );
  if (!data.clan)
    return (
      <Empty title="Your player isn’t in a clan right now">
        When Elixir sees them join one, its members show here.
      </Empty>
    );
  const clanName = data.clan.name ?? data.clan.clan_tag;
  const others = data.players;
  const plan = followPlanLine(data);
  return (
    <Panel
      title={<TagText>{clanName}</TagText>}
      action={
        data.to_follow > 0 ? (
          <FollowAll
            ask={{ clan_tag: data.clan.clan_tag }}
            label="Follow my clan"
            title={`Follow everyone in ${clanName}?`}
          />
        ) : null
      }
    >
      {plan ? <p className="kit-tiny kit-people__slots">{plan}</p> : null}
      {others.length === 0 ? (
        <p className="kit-week__quiet kit-people__quiet">
          Nobody else in your clan yet.
        </p>
      ) : (
        <Rows>
          {others.map((p) => (
            <Person
              key={p.player_tag}
              p={p}
              used={data.used}
              limit={data.limit}
              detail={p.following ? null : costMark(p)}
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}
