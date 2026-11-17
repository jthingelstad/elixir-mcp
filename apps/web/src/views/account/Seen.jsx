import { useState } from "react";
import {
  Chips,
  Empty,
  ErrorState,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  TagText,
  ZoneProvider,
  browserZone,
} from "@elixir-mcp/ui";
import { useToolRead } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";
import { playerHref } from "../../lib/player.js";
import { Battle } from "../Battle.jsx";
import { useMyPlace } from "../../clan/lib/queries.js";
import { placeLabel } from "../../clan/lib/place-label.js";
import { PLACE_HREF } from "../../lib/passport.js";
import { PLACE_WHO } from "../../clan/views/YourPlace.jsx";
import { Facts, Note } from "./parts.jsx";
import { FollowSlots } from "./Slots.jsx";

/**
 * What members see (#769): who sees what of you, gathered on one page from
 * what is already built. Every line here is a statement about the code as
 * it runs, checked against the route or query that serves it
 * (docs/notes/2026-11-12-what-members-see.md lists each one); a line that
 * stops being true is a defect of this page, never of the surface it
 * describes. One control lives here, as the canvas draws it (2026-11-12):
 * your follow slots, each slot-using follow with its way to stop
 * (Slots.jsx). Location names your place and links to its one editor,
 * Settings › Profile's Your place (2026-11-14). The other choices link to
 * the pages that own them.
 */

/** The viewers the lens can stand in for. Neither is you: a member is
 *  someone signed in who tracks none of your players, and someone with
 *  the link has no account at all. */
const VIEWERS = {
  member: { authenticated: true, claims: [] },
  link: { authenticated: false },
};

const LENS_OPTIONS = [
  { key: "member", label: "A member" },
  { key: "link", label: "Someone with the link" },
];

/** A battle link's path, from the absolute address Elixir hands out. */
const refOf = (url) => /\/battle\/([0-9a-f]{12,64})$/.exec(url ?? "")?.[1];

export function Seen({ me }) {
  const main = (me?.claims ?? []).find((c) => c.is_primary) ?? null;
  return (
    <div className="st-page st-seen">
      <PageHead
        title="What members see"
        sub="Who sees what of you on Elixir, as it works today."
      />
      <Panel title="Members who are signed in" titleAs="h2">
        <Facts
          stacked
          rows={[
            [
              "Your players’ games",
              <>
                Each player’s game name, tag, clan and role, profile, battles
                and decks, and the timeline of what they did in the game.
                <Note>
                  This is public game data: every member can look up any player
                  Elixir records, yours included.
                </Note>
              </>,
            ],
            [
              "That a player is yours",
              <>
                Not shown yet: members see your players as players, never as
                your account. Elixir’s rule is that who an account follows, who
                follows it and its verified player are for members to see; no
                page shows them yet.
                <Note>
                  Two answers say only that some account is behind a player,
                  never which: making a player you verified their own says
                  another account has verified it, and following a player you
                  follow can cost them no slot because another account follows
                  them first.
                </Note>
              </>,
            ],
            [
              "A post you write about a battle",
              <>
                On that player’s timeline and page, for members who follow the
                player or are in their clan, and on the player’s page for any
                member: its game name, your words and the battle. Not your
                account.
                <Note>
                  A follower who cross-posts their timeline to a Discord channel
                  sends it there too, where everyone in the channel reads it,
                  and an edit to your words is edited there. Deleting the post
                  takes it off the timeline; a line already posted to Discord
                  stays.
                </Note>
              </>,
            ],
            [
              "Your place, if you set one",
              <>
                The city, region or country you picked, never closer, with your
                verified player&rsquo;s game name and tag: on the player map,
                and in Near you for members in your region.
                <Note>
                  To stop showing it anywhere, remove your place on Profile.
                </Note>
              </>,
            ],
            [
              "A cheer you give",
              <>
                A count on that item, for every member whose feed shows it: how
                many gave each cheer, never who. You see your own as yours.
                <Note>
                  A cheer goes nowhere else: not to Discord, mail, the bell or
                  an agent's tools.
                </Note>
              </>,
            ],
            [
              "A collector you run",
              <>
                Credited to your main player’s game name and tag, with its card
                name, status and fetch counts, on the list of collectors. That
                list is on the public status page too.
              </>,
            ],
            [
              "In your clan, in Clan",
              <>
                The clan’s verified members see your place on its map, if you
                added one, with its local time. Its leaders see an away you
                mark.
                <Note>
                  What you decide as a leader or elder shows under your player’s
                  game name, and an action posted in the clan’s Discord is
                  edited to say who closed it.
                </Note>
              </>,
            ],
            [
              "An AI agent for your clan",
              <>
                With Discord connected, an agent that follows a clan your main
                player or an alt is in can ask which player you are by your
                Discord user id. It learns that player’s tag and whether it is
                verified, never your Discord name or your email.
              </>,
            ],
          ]}
        />
      </Panel>
      <Panel title="Someone with a link you send" titleAs="h2">
        <Facts
          stacked
          rows={[
            [
              "A battle link",
              <>
                Opens with no account. It shows both sides’ game names, clans
                and trophies, both decks, the towers and how it ended, the left
                player’s other battles in that session, and earlier battles
                between the two.
                <Note>
                  The page’s data carries the players’ tags too, and its share
                  picture shows the battle alone.
                </Note>
              </>,
            ],
            [
              "A post about a battle you share",
              <>
                Opens with no account: your player’s game name and your words
                over the battle as its own link shows it. Its picture carries
                the name, the words and the link.
                <Note>
                  Delete the post and its link stops opening within about a
                  minute.
                </Note>
              </>,
            ],
            [
              "What a link carries",
              <>
                The battle’s or the post’s id and nothing else: no account
                id, nickname or email. Whoever has it can pass it on.
              </>,
            ],
          ]}
        />
      </Panel>
      <Panel title="Only you, or nobody" titleAs="h2">
        <Facts
          stacked
          rows={[
            [
              "Nicknames you give players",
              <>
                Only you, and the apps you connect as yourself. Everywhere else
                players go by their game names.
              </>,
            ],
            [
              "Your email address",
              <>
                Nobody else. It goes only to an app of Elixir’s own, like Elixir
                Drop, that you sign in to and allow to see it.
              </>,
            ],
            [
              "Your Discord name and profile",
              <>Nobody else. Profile and Connections show it to you.</>,
            ],
            [
              "Your RSS link",
              <>
                Only you, and anyone you give it to: whoever holds the link
                reads your timeline in a feed reader, by game names, with no
                nicknames, email or account business. Turning it off or
                resetting it stops it at once.
              </>,
            ],
            [
              "Your account’s machinery",
              <>
                Only you: sign-ins and devices, agents and their keys,
                connections, usage and calls, the mail sent to you, and your
                feedback.
              </>,
            ],
          ]}
        />
        <p className="st-foot">
          Nobody else means no other member and no one holding a link. Elixir’s
          maintainer can open account records to run the service and answer
          feedback; none of it is published.
        </p>
      </Panel>
      <Panel title="Your choices" titleAs="h2">
        <section aria-labelledby="seen-location" id="location">
          <h3 id="seen-location" className="st-group">
            Location
          </h3>
          <Rows>
            <Row
              title="Your place"
              detail={<PlaceNow />}
              href={PLACE_HREF}
              right="Profile"
            />
          </Rows>
          <p className="st-foot st-inset mt-2">
            {PLACE_WHO} Nobody else: not anyone with a link, and not an agent.
          </p>
        </section>
        <Rows>
          <Row
            title="Discord"
            detail="Connect or disconnect it, and cross-post your timeline to a channel, where everyone in it reads each line."
            href={`${SETTINGS}/connections/discord`}
          />
          <Row
            title="Your posts about battles"
            detail="Post, edit, share or delete one on the battle’s own page; your Timeline links each battle."
            href="/timeline"
          />
          <Row
            title="Your RSS link"
            detail="Make, reset or turn off the private link to your timeline."
            href={`${SETTINGS}/connections`}
          />
          <Row
            title="Players & following"
            detail="Who you follow, and your main player, which a collector’s credit names."
            href={`${SETTINGS}/players`}
          />
        </Rows>
      </Panel>
      <FollowSlots />
      <Lens main={main} />
    </div>
  );
}

/** Your main player's latest recorded battle, drawn by the battle page
 *  itself from /api/public/battles: the one answer every viewer gets.
 *  Only the viewer changes. */
function Lens({ main }) {
  const [viewer, setViewer] = useState("member");
  const tag = main?.player_tag ?? null;
  const latest = useToolRead(
    "battles_query",
    { player_tag: tag, limit: 1, verbosity: "compact" },
    { enabled: !!tag },
  );
  const ref = refOf(latest.data?.battles?.[0]?.url);
  let body;
  if (!tag)
    body = (
      <Empty
        title="No main player yet"
        action={
          <Link
            className="btn btn--sm"
            to={`${SETTINGS}/players#add-player-tag`}
          >
            Add your player
          </Link>
        }
      >
        The lens shows your main player’s latest battle.
      </Empty>
    );
  else if (latest.isError)
    body = <ErrorState onRetry={() => latest.refetch()} />;
  else if (latest.isPending)
    body = (
      <p className="text-ink-faint" role="status">
        Reading your latest battle.
      </p>
    );
  else if (!ref)
    body = (
      <Empty title="No recorded battle yet">
        Once Elixir records a battle of{" "}
        <TagText>{main.name ?? main.player_tag}</TagText>, it shows here.
      </Empty>
    );
  else
    body = (
      <>
        <Chips
          label="See it as"
          options={LENS_OPTIONS}
          value={viewer}
          onChange={setViewer}
        />
        {viewer === "link" ? (
          <ZoneProvider zone={browserZone()}>
            <Battle key="link" battleRef={ref} me={VIEWERS.link} standIn />
          </ZoneProvider>
        ) : (
          <Battle key="member" battleRef={ref} me={VIEWERS.member} standIn />
        )}
      </>
    );
  return (
    <Panel title="See it as they do" titleAs="h2" pad>
      <p className="m-0">
        Your main player’s latest battle, drawn by the battle page from the
        answer everyone gets. Your player’s own page reads the record every
        member reads; a nickname you gave shows only to you.
      </p>
      {tag ? (
        <Link className="btn btn--quiet st-seen__out" to={playerHref(tag)}>
          Open your player’s page
        </Link>
      ) : null}
      {body}
    </Panel>
  );
}

/** Your place as Location's row says it: the place, Not set, or what
 *  setting one needs. Profile's Your place changes it. */
function PlaceNow() {
  const { state } = useMyPlace();
  if (state.forbidden) return "Not set. A place needs a verified player.";
  if (state.error || state.signedOut)
    return "Set, change or remove it on Profile.";
  if (!state.data) return "Reading your place.";
  const place = state.data.place;
  return place ? placeLabel(place) : "Not set";
}
