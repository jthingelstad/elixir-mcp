import { PlayerName } from "@elixir-mcp/ui";
import { useState } from "react";
import {
  Avatar,
  Empty,
  Link,
  Panel,
  Row,
  Rows,
  TagText,
  useClock,
  WriteError,
  ErrorState,
} from "@elixir-mcp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../client/index.ts";
import { api } from "../api.js";
import { playerHref } from "../lib/player.js";
import { usePeople } from "../lib/queries.js";
import { FollowAll, FollowButton, followPlanLine } from "./follow.jsx";
import {
  costMark,
  FREE_HINT,
  lastMetLine,
  metLine,
  roleLabel,
  slotsLine,
  starterPlan,
  whyLines,
} from "./logic.js";

/**
 * People to follow (2026-11-12): Home's side panel and Find's From your
 * battles and Your clan. Each person by game name and tag (never a
 * nickname), why they are here as a fact, and what following them costs.
 * Never ranked by skill: the server orders by the facts it states. A row
 * marks only a follow that costs nothing ("Free"); what following costs is
 * one line by the button that follows (2026-11-13).
 */

/** The small Free mark: a player Elixir records already. */
function FreeMark({ p }) {
  const mark = costMark(p);
  return mark ? (
    <span className="kit-people__cost kit-people__cost--free" title={FREE_HINT}>
      {mark}
    </span>
  ) : null;
}

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
      lead={
        <Avatar
          name={p.name ?? tag}
          tag={tag}
          card={p.avatar_card_id ?? null}
          small
        />
      }
      title={
        <Link to={playerHref(tag)} className="hit">
          <PlayerName tag={tag}>
            <TagText>{p.name ?? tag}</TagText>
          </PlayerName>
        </Link>
      }
      detail={detail}
      right={
        p.following ? (
          <span className="kit-following">Following</span>
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

/** A suggestion's why, as facts, and Free when it costs nothing. */
function WhyCost({ p, dayHeading }) {
  return (
    <>
      <span className="kit-people__why">{whyLines(p.why, { dayHeading })}</span>
      <FreeMark p={p} />
    </>
  );
}

/** Home's side panel: a few people, each with why and what it costs. It reads
 *  for itself, after the feed, so Home's first paint never waits on it. */
export function PeopleToFollow() {
  const { feedDayHeading } = useClock();
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
        <ErrorState
          title="Suggestions could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment, or <Link to="/home/find">find people</Link>.
        </ErrorState>
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
          Nobody new to suggest right now. Battle on and check back.
        </p>
      ) : (
        <Rows>
          {data.people.map((p) => (
            <Person
              key={p.tag}
              p={p}
              used={data.used}
              limit={data.limit}
              detail={<WhyCost p={p} dayHeading={feedDayHeading} />}
            />
          ))}
        </Rows>
      )}
      {slots ? (
        <div className="kit-people__slots">
          <p className="kit-tiny">{slots}</p>
          {data.limit ? (
            <progress
              className="kit-meter"
              value={Math.min(data.used ?? 0, data.limit)}
              max={data.limit}
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** Find's Suggested shows this many before Show more. */
const FIND_SHOWN = 10;

/**
 * Find's Suggested (2026-11-13), the tab Find opens on: a list to tap
 * through, each with why as a fact and what following costs (Jamie: "give
 * me a list to just click on of suggested follows and give me a line on
 * why"). The same sources as People to follow and the starter set, over a
 * month. With nobody to suggest it says what fills it and points to Search
 * and your Follow me link.
 */
export function FindSuggested({ onSearch, onLink }) {
  const { feedDayHeading } = useClock();
  const query = usePeople("find");
  const [all, setAll] = useState(false);
  const data = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !data?.ok)
    return (
      <Panel pad>
        <ErrorState
          title="Suggestions could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </Panel>
    );
  if (data.people.length === 0)
    return (
      <Panel pad className="kit-findsuggest" aria-label="Suggested">
        <p className="kit-week__quiet">
          Nobody to suggest yet. Friendly battles, 2v2 teammates, the players
          your follows follow and your clan show up here.
        </p>
        <div className="kit-findsuggest__ways">
          <button type="button" className="btn btn--sm" onClick={onSearch}>
            Search by name or tag
          </button>
          {onLink ? (
            <button type="button" className="btn btn--sm" onClick={onLink}>
              Send your Follow me link
            </button>
          ) : null}
        </div>
      </Panel>
    );
  const shown = all ? data.people : data.people.slice(0, FIND_SHOWN);
  // The tab names the list, so the panel has no title of its own; Find's
  // side has the follows meter, so the foot does not repeat it.
  return (
    <Panel className="kit-findsuggest" aria-label="Suggested">
      <Rows>
        {shown.map((p) => (
          <Person
            key={p.tag}
            p={p}
            used={data.used}
            limit={data.limit}
            detail={<WhyCost p={p} dayHeading={feedDayHeading} />}
          />
        ))}
      </Rows>
      {data.people.length > FIND_SHOWN ? (
        <div className="kit-findsuggest__more">
          <button
            type="button"
            className="btn btn--sm"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all
              ? "Show fewer"
              : `Show more (${data.people.length - FIND_SHOWN})`}
          </button>
        </div>
      ) : null}
      <p className="kit-tiny kit-people__slots">
        From your battles in the last {data.days} days, the players your follows
        follow, and your clan. Never ranked.
        {all && data.more > 0
          ? " More are in From your battles and Your clan."
          : ""}
      </p>
    </Panel>
  );
}

/** Find's From your battles: everyone your players met in the last month,
 *  how often and how it went, from the log only. */
export function FromYourBattles() {
  const query = usePeople("battles");
  const { feedWhen } = useClock();
  const data = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !data?.ok)
    return (
      <Panel pad>
        <ErrorState
          title="Your battles could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </Panel>
    );
  return (
    <Panel title={`From your battle log, last ${data.days} days`}>
      {data.people.length === 0 ? (
        <p className="kit-week__quiet kit-people__quiet">
          Nobody yet. Players you meet in battle show up here.
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
                  <span className="kit-people__why">{metLine(p)}</span>
                  {p.last_met ? (
                    <span className="kit-people__when">
                      {lastMetLine(p, feedWhen)}
                    </span>
                  ) : null}
                  <FreeMark p={p} />
                </>
              }
            />
          ))}
        </Rows>
      )}
      <p className="kit-tiny kit-people__slots">
        Straight from your battle log: how often you met and how it went. No
        ratings, no guesses.
        {data.more > 0
          ? ` The ${data.people.length} you met most are shown; ${data.more} more are not.`
          : ""}
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
        <ErrorState
          title="Your clan could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </Panel>
    );
  if (!data.clan)
    return (
      <Empty title="Your player isn’t in a clan right now">
        Join one in the game and your clanmates show up here.
      </Empty>
    );
  const clanName = data.clan.name ?? data.clan.clan_tag;
  const others = data.players;
  const plan = followPlanLine(data);
  const members = others.length + (data.yours?.length ?? 0);
  const followed = others.filter((p) => p.following).length;
  return (
    <Panel className="kit-panel--mine kit-clanpeople" aria-label={clanName}>
      <div className="kit-clanpeople__head">
        <Avatar name={clanName} tag={data.clan.clan_tag} clan />
        <div className="kit-clanpeople__who">
          <h2 className="kit-clanpeople__name">
            <TagText>{clanName}</TagText>
          </h2>
          <p className="kit-clanpeople__line">
            {members.toLocaleString()} {members === 1 ? "member" : "members"} ·
            you follow {followed.toLocaleString()}
          </p>
        </div>
        {data.to_follow > 0 ? (
          <FollowAll
            ask={{ clan_tag: data.clan.clan_tag }}
            label="Follow my clan"
            title={`Follow everyone in ${clanName}?`}
            className="btn btn--follow"
          />
        ) : null}
      </div>
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
              detail={
                <>
                  {roleLabel(p.role) ? (
                    <span className="kit-people__why">{roleLabel(p.role)}</span>
                  ) : null}
                  <FreeMark p={p} />
                </>
              }
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}

/** The starter set's rows shown before Show all: with its head and Follow
 *  these, enough to fill a phone's first screen and no more. */
const STARTER_SHOWN = 5;

/**
 * Home's suggested follows (2026-11-13), at the top of Home on every visit
 * while the account follows few players (offersStarter). Every row is
 * ticked; untick anyone, then one confirmed Follow these (the follow-all a
 * clan's Follow everyone uses), priced from this read and refused whole
 * past the slots left. Nothing is followed without that tap. Follow these
 * sits beside the heading with what it costs on one line under it, so a
 * small phone's first screen holds the button and three rows with their
 * reasons. "Not now" puts it aside for 30 days. With
 * nobody to suggest it is one line pointing to Find. `query` is
 * usePeople("starter"), read apart from the feed; the panel draws nothing
 * while it reads, on a failure or when the server offers none.
 */
export function StarterSet({ query }) {
  const { feedDayHeading } = useClock();
  const [off, setOff] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  const queryClient = useQueryClient();
  const hide = useWrite(api.hideStarter, {
    invalidate: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["me", "home"],
        exact: true,
      });
    },
  });
  const data = query.data;
  if (hidden || !data?.ok || !data.offer) return null;
  const people = data.people ?? [];
  const notNow = (
    <button
      type="button"
      className="btn btn--sm btn--quiet kit-starter__not-now"
      disabled={hide.busy}
      onClick={async () => {
        setHidden(true);
        const res = await hide.run();
        if (!res.ok) setHidden(false);
      }}
    >
      Not now
    </button>
  );
  if (!people.length)
    return (
      <section
        className="kit-starter kit-starter--empty"
        aria-labelledby="kit-starter-head"
      >
        <h2 id="kit-starter-head" className="kit-starter__head">
          People you know
        </h2>
        <p className="kit-starter__lead">
          Nobody to suggest yet: friendly battles, 2v2 teammates and your clan
          show up here.{" "}
          <Link to="/home/find">
            Search by name or tag, or send your Follow me link
          </Link>
          .
        </p>
        {notNow}
        <WriteError error={hide.error} className="field-error" />
      </section>
    );
  const chosen = people.filter((p) => !off.has(p.tag));
  const plan = starterPlan(chosen, data.used, data.limit);
  const shown = all ? people : people.slice(0, STARTER_SHOWN);
  const toggle = (tag) =>
    setOff((was) => {
      const next = new Set(was);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  return (
    <section className="kit-starter" aria-labelledby="kit-starter-head">
      <div className="kit-starter__top">
        <h2 id="kit-starter-head" className="kit-starter__head">
          People you know
        </h2>
        <FollowAll
          ask={{ player_tags: chosen.map((p) => p.tag) }}
          plan={plan}
          label={`Follow these (${plan.to_follow})`}
          title={`Follow ${plan.to_follow} ${plan.to_follow === 1 ? "player" : "players"}?`}
          confirm="Follow these"
          className="btn btn--follow"
        />
        <p className="kit-tiny kit-starter__sum" role="status">
          {followPlanLine(plan)}
        </p>
      </div>
      <Rows>
        {shown.map((p) => {
          const id = `starter-${p.tag.slice(1)}`;
          const name = p.name ?? p.tag;
          return (
            <Row
              key={p.tag}
              className="kit-people__row kit-starter__row"
              lead={
                <label className="kit-starter__tick" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={!off.has(p.tag)}
                    onChange={() => toggle(p.tag)}
                    aria-label={`Follow ${name}`}
                  />
                </label>
              }
              title={
                <Link to={playerHref(p.tag)} className="hit">
                  <TagText>{name}</TagText>
                </Link>
              }
              detail={<WhyCost p={p} dayHeading={feedDayHeading} />}
            />
          );
        })}
      </Rows>
      {people.length > STARTER_SHOWN ? (
        <button
          type="button"
          className="btn btn--sm btn--quiet kit-starter__more"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show all ${people.length}`}
        </button>
      ) : null}
      <div className="kit-starter__foot">
        <p className="kit-tiny">Untick anyone you&rsquo;d rather not follow.</p>
        {notNow}
      </div>
      <WriteError error={hide.error} className="field-error" />
    </section>
  );
}
