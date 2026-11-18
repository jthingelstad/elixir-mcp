import { PlayerName } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
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
import { FeedItem } from "./FeedItem.jsx";
import {
  followedMomentKey,
  useFollowedMoment,
  useFollowPlan,
  usePeople,
} from "../lib/queries.js";
import { PLACE_HREF } from "../lib/passport.js";
import { SETTINGS } from "../lib/settings.js";
import { FollowAll, FollowButton, followPlanLine } from "./follow.jsx";
import { ClanmateState, isClanmateConnection } from "./Connection.jsx";
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

function Person({ p, detail, used, limit, roster = false }) {
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
        isClanmateConnection(p) ? (
          <ClanmateState
            friend={p.connection === "friend"}
            close={p.close === true}
          />
        ) : roster ? (
          <span className="kit-tiny">Clan member</span>
        ) : p.following ? (
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
      {isClanmateConnection(p) ? null : <FreeMark p={p} />}
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
          your follows follow show up here. Clanmates connect automatically.
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
        From your battles in the last {data.days} days and the players your
        follows follow. Clanmates connect automatically. Never ranked.
        {all && data.more > 0 ? " More are in From your battles." : ""}
      </p>
    </Panel>
  );
}

/**
 * Find's Near you (#768, Jamie 2026-11-14): the people who set a place
 * in your country and region, as the players they verified, each with
 * where as a plain fact and a Follow. Your city first, then by name; never
 * ranked by trophies, wins or any score, and never closer than the place
 * each picked. Only for a reader with a place; anyone else is asked to set
 * one. Setting a place is what puts someone here (2026-11-15): there is
 * no other choice to make.
 */
/** Near you, then whatever Find draws under it (the player map). The
 *  map comes only once this read answers, so a reader offline sees one
 *  error and one Try again, never two stacked (2026-11-16). */
export function NearYou({ children = null }) {
  const query = usePeople("near");
  const data = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !data?.ok)
    return (
      <Panel pad>
        <ErrorState
          title="Players near you could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </Panel>
    );
  if (!data.place)
    return (
      <>
        <Panel pad className="kit-near" aria-label="Near you">
          <p className="kit-week__quiet">
            Set your place to see players near you. A country, a region or a
            city, never closer.
          </p>
          <div className="kit-findsuggest__ways">
            <Link to={PLACE_HREF} className="btn btn--sm btn--primary">
              Set your place
            </Link>
          </div>
        </Panel>
        {children}
      </>
    );
  return (
    <>
      <Panel className="kit-near" aria-label="Near you">
        {data.people.length === 0 ? (
          <p className="kit-week__quiet kit-near__empty">
            Nobody else in {data.place.region_name} has set a place yet.
          </p>
        ) : (
          <Rows>
            {data.people.map((p) => (
              <Person
                key={p.tag}
                p={p}
                used={data.used}
                limit={data.limit}
                detail={<WhyCost p={p} />}
              />
            ))}
          </Rows>
        )}
        <p className="kit-tiny kit-people__slots">
          People who set a place in {data.place.region_name}. Your city first,
          then by name. Never ranked.
          {data.truncated
            ? ` Showing the first ${data.people.length}.`
            : ""}{" "}
          <Link to={PLACE_HREF} className="hit">
            Your place
          </Link>
        </p>
      </Panel>
      {children}
    </>
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
 *  their automatic connection. Friending is a voluntary player-page action. */
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
  const clans = data.clans ?? [];
  if (clans.length === 0)
    return (
      <Empty
        title={
          data.requires_verification
            ? "Verify your player to connect with clanmates"
            : "No clanmates connected yet"
        }
        action={
          data.requires_verification ? (
            <Link to={`${SETTINGS}/players/verify`} className="btn btn--sm">
              Verify your player
            </Link>
          ) : null
        }
      >
        {data.requires_verification
          ? "Clanmates connect through your verified players. Verify the player you play as to see its clanmates here."
          : "Clanmates appear after Elixir reads a current roster for one of your verified players."}
      </Empty>
    );
  return (
    <div className="kit-clanpeople-list">
      <p className="kit-tiny kit-people__slots">
        Clanmates connect automatically through your verified players.
        Membership comes from Clash Royale.
      </p>
      {clans.map((clan) => (
        <ClanPeoplePanel
          key={clan.clan_tag}
          clan={clan}
          players={data.players ?? []}
        />
      ))}
    </div>
  );
}

function ClanPeoplePanel({ clan, players }) {
  const clanName = clan.name ?? clan.clan_tag;
  const others = players.filter(
    (p) => p.shared_clan?.clan_tag === clan.clan_tag,
  );
  return (
    <Panel className="kit-panel--mine kit-clanpeople" aria-label={clanName}>
      <div className="kit-clanpeople__head">
        <Avatar name={clanName} tag={clan.clan_tag} clan />
        <div className="kit-clanpeople__who">
          <h2 className="kit-clanpeople__name">
            <TagText>{clanName}</TagText>
          </h2>
          <p className="kit-clanpeople__line">
            {others.length.toLocaleString()}{" "}
            {others.length === 1 ? "clanmate" : "clanmates"} connected
          </p>
        </div>
      </div>
      {others.length === 0 ? (
        <p className="kit-week__quiet kit-people__quiet">
          Nobody else connected from this clan right now.
        </p>
      ) : (
        <Rows>
          {others.map((p) => (
            <Person
              key={p.player_tag}
              p={p}
              roster
              detail={
                <>
                  {roleLabel(p.role) ? (
                    <span className="kit-people__why">{roleLabel(p.role)}</span>
                  ) : null}
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
export function StarterSet({ query, onOpenTimeline, onFollowed }) {
  const { feedDayHeading } = useClock();
  const [off, setOff] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [followed, setFollowed] = useState(() => new Set());
  const [remaining, setRemaining] = useState(null);
  const [latest, setLatest] = useState([]);
  const moment = useFollowedMoment(latest);
  const finish = useRef(null);
  useEffect(() => {
    if (followed.size) finish.current?.focus();
  }, [followed]);
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
  const people = (data?.offer ? (data.people ?? []) : (remaining ?? [])).filter(
    (p) => !followed.has(p.tag),
  );
  const chosen = people.filter((p) => !off.has(p.tag));
  // The normal offer can end after these follows. Retain the unticked
  // names, but price any later choice through the canonical plan reader.
  const retainedPlan = useFollowPlan(
    { player_tags: chosen.map((p) => p.tag) },
    !data?.offer && followed.size > 0,
  );
  const plan = data?.offer
    ? starterPlan(chosen, data.used, data.limit)
    : (retainedPlan.data ?? null);
  if (hidden || !data?.ok || (!data.offer && followed.size === 0)) return null;
  const confirmation = followed.size ? (
    <div className="kit-starter__confirmation">
      <p role="status" className="kit-starter__lead">
        Your follows are ready.
      </p>
      {onOpenTimeline ? (
        <button
          ref={finish}
          type="button"
          className="btn btn--sm"
          onClick={onOpenTimeline}
        >
          Open Timeline
        </button>
      ) : (
        <Link ref={finish} to="/timeline" className="btn btn--sm">
          Open Timeline
        </Link>
      )}
      {moment.data?.item ? (
        <section
          aria-label="From your new follows"
          className="kit-starter__moment"
        >
          <FeedItem
            it={moment.data.item}
            cheerWhere={{ key: followedMomentKey(latest), list: "item" }}
          />
        </section>
      ) : null}
    </div>
  ) : null;
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
        {confirmation}
        <p className="kit-starter__lead">
          {followed.size
            ? "Find more people in Find. "
            : "Clanmates connect automatically through your verified players. New friends from friendly battles and 2v2 teammates show up here. "}
          <Link to="/home/find">
            Search by name or tag, or send your Follow me link
          </Link>
          .
        </p>
        {notNow}
        <WriteError error={hide.error} className="field-error" />
      </section>
    );
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
      {confirmation}
      <div className="kit-starter__top">
        <h2 id="kit-starter-head" className="kit-starter__head">
          People you know
        </h2>
        <FollowAll
          ask={{ player_tags: chosen.map((p) => p.tag) }}
          plan={plan}
          label={`Follow these (${chosen.length})`}
          title={`Follow ${chosen.length} ${chosen.length === 1 ? "player" : "players"}?`}
          confirm="Follow these"
          className="btn btn--follow"
          onDone={(result) => {
            if (result?.followed?.length) {
              setLatest(result.followed);
              setRemaining(
                people.filter((p) => !result.followed.includes(p.tag)),
              );
              setFollowed((was) => new Set([...was, ...result.followed]));
              onFollowed?.();
            }
          }}
        />
        <p className="kit-tiny kit-starter__sum" role="status">
          {chosen.length === 0
            ? "Tick someone to follow them."
            : plan
              ? followPlanLine(plan)
              : retainedPlan.isError
                ? "What this costs could not be read just now."
                : "Checking what this costs…"}
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
