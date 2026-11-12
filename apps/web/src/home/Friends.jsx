import { useState } from "react";
import { DeckGrid, Empty, ErrorState, Link, TagText } from "@elixir-mcp/ui";
import { playerHref } from "../lib/player.js";
import { FollowCost, Followed, useFollow } from "./follow.jsx";
import { familyLine, friendsView, names } from "./logic.js";

/**
 * Home › Friends: the week Wednesday's mail tells, from the mail's own
 * builder. A Follow here makes a Friend (Q10), and never the person's main
 * player. The rest of what a tracked person can be stays on Tracking for now.
 */
export function HomeFriends({ query }) {
  const data = query.data;
  if (query.isPending) return <FriendsLoading />;
  if (query.isError)
    return (
      <ErrorState
        title="Friends could not be read just now."
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again shortly.
      </ErrorState>
    );
  if (data.no_player)
    return (
      <Empty
        title="Add your own player first"
        action={
          <Link to="/home" className="btn btn--sm">
            Add your player
          </Link>
        }
      >
        Friends sit beside your own record, so Elixir needs to know who you are
        before you follow anyone.
      </Empty>
    );
  const view = friendsView(data);
  return (
    <div className="kit-home">
      <FollowForm />
      {view.empty ? (
        <Empty title="You aren’t following anyone yet">
          Follow a friend to see their week here and in Wednesday&rsquo;s mail.
        </Empty>
      ) : view.nobody ? (
        <Empty title="Nobody you follow has a battle recorded this week">
          Everyone you follow: {names(view.everyone)}.
        </Empty>
      ) : (
        <>
          <FriendsSection view={view} />
          <WatchingSection view={view} />
          <p className="kit-tiny">
            A deck&rsquo;s count is battles with exactly those eight cards.
          </p>
        </>
      )}
    </div>
  );
}

function FriendsLoading() {
  return (
    <div className="kit-home" aria-busy="true">
      <div className="kit-skeleton" />
      <div className="kit-skeleton" />
    </div>
  );
}

const nameOf = (p) => p.nickname ?? p.name ?? p.tag;

function FriendsSection({ view }) {
  if (view.friendsTotal === 0) return null;
  return (
    <section className="kit-fsec">
      <header className="kit-fsec__head">
        <h2>Friends</h2>
        <span>
          {view.friends.length} of {view.friendsTotal} played
        </span>
      </header>
      <div className="kit-fcards">
        {view.friends.map((p) => (
          <FriendCard key={p.tag} person={p} />
        ))}
      </div>
      {view.friendsQuiet.length > 0 ? (
        <p className="kit-fsec__quiet">
          No battle recorded this week:{" "}
          <TagText>{names(view.friendsQuiet)}</TagText>.
        </p>
      ) : null}
    </section>
  );
}

/** A name opens the player page (#764). */
function FriendCard({ person: p }) {
  return (
    <article className="kit-fcard">
      <div className="kit-fcard__head">
        <Link to={playerHref(p.tag)} className="kit-fcard__who">
          <TagText>{nameOf(p)}</TagText>
        </Link>
        <span>
          {p.battles} {p.battles === 1 ? "battle" : "battles"}
        </span>
      </div>
      <p className="kit-fcard__line">{familyLine(p.by_family)}</p>
      {(p.moments ?? []).length > 0 ? (
        <ul className="kit-fcard__moments">
          {p.moments.map((m, i) => (
            <li key={i}>
              <TagText>{String(m.text ?? m)}</TagText>
            </li>
          ))}
        </ul>
      ) : null}
      {p.deck ? (
        <div className="kit-deck">
          <div className="kit-deck__head">
            <span className="kit-deck__name">
              {p.deck.label ?? "Most played deck"}
            </span>
            <span className="kit-deck__note">
              {p.deck.battles} of {p.battles} battles
            </span>
          </div>
          <DeckGrid
            cards={p.deck.cards}
            size={44}
            columns={8}
            showLevel={false}
            label={p.deck.label ?? "Most played deck"}
          />
        </div>
      ) : null}
    </article>
  );
}

function WatchingSection({ view }) {
  const total =
    view.watching.length + view.watchingQuiet.length + view.watchingLong.length;
  if (total === 0) return null;
  return (
    <section className="kit-fsec">
      <header className="kit-fsec__head">
        <h2>Watching</h2>
        <span>{view.watching.length} played this week</span>
      </header>
      {view.watching.length > 0 ? (
        <div className="kit-rows">
          {view.watching.map((p) => (
            <div key={p.tag} className="kit-row">
              <span className="kit-row__main">
                <Link to={playerHref(p.tag)} className="kit-row__title">
                  <TagText>{nameOf(p)}</TagText>
                </Link>
                <span className="kit-row__detail">
                  {p.line ??
                    `${p.battles} ${p.battles === 1 ? "battle" : "battles"}, ${p.wins}W-${p.losses}L`}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {view.watchingQuiet.length > 0 ? (
        <p className="kit-fsec__quiet">
          No battle recorded this week:{" "}
          <TagText>{names(view.watchingQuiet)}</TagText>.
        </p>
      ) : null}
      {view.watchingLong.length > 0 ? (
        <p className="kit-fsec__quiet">
          Quiet for 30 days or more:{" "}
          <TagText>{names(view.watchingLong)}</TagText>.
        </p>
      ) : null}
    </section>
  );
}

/** The Follow form. It posts one relationship and reads back what became of
 *  it: added, already yours, already followed, or not found in the game. */
function FollowForm() {
  const [tag, setTag] = useState("");
  const { follow, busy, error: err, result } = useFollow();
  return (
    <div className="kit-follow">
      <form
        className="kit-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!tag.trim()) return;
          if (await follow(tag.trim())) setTag("");
        }}
      >
        <label htmlFor="home-follow-tag">Follow a friend</label>
        <div className="kit-form__row">
          <input
            id="home-follow-tag"
            className="input"
            placeholder="#TAG"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Follow
          </button>
        </div>
        {err ? (
          <p className="kit-form__err" role="alert">
            {err}
          </p>
        ) : (
          <>
            <FollowCost tag={tag} />
            <p className="kit-tiny">
              Anyone with a player tag can be followed. They aren&rsquo;t told.
              Recording starts at once; the first read usually lands within a
              minute.
            </p>
          </>
        )}
      </form>
      {result ? <Followed result={result} /> : null}
    </div>
  );
}
