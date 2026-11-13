import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "@elixir-mcp/client";
import {
  DeckGrid,
  Empty,
  ErrorState,
  FreshChip,
  Link,
  Panel,
  Rows,
  Row,
  Stat,
  Stats,
  Chips,
  TagText,
  useClock,
  WriteError,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { PeopleToFollow, StarterSet } from "./People.jsx";
import { RacePlace } from "./RacePlace.jsx";
import { ladderHref } from "../ladder/ladder.js";
import { SETTINGS } from "../lib/settings.js";
import { tagPath } from "../lib/tag-url.js";
import {
  keys,
  useHomeClan,
  useHomeNeeds,
  useHomeWeek,
  useInvalidate,
  usePeople,
} from "../lib/queries.js";
import {
  LEADS,
  STANDING,
  actionsFrom,
  DIGEST_CHOICES,
  digestChoice,
  digestLine,
  digestWhen,
  lastRaceLine,
  modeWord,
  offersStarter,
  raceNowLine,
  panelOf,
  weekChips,
  welcomeSteps,
} from "./logic.js";

const DASH = "–";

/** Home (slice 7, #765): the one feed beside your week, your clan and People
 *  to follow (2026-11-12), under the welcome steps until they are done (G4).
 *  Each
 *  side panel reads for itself and draws its own loading state; a panel that
 *  failed says so, the rest render. Needs you moved to the bell, which every
 *  page wears (shell/Bell.jsx); the unlock notice stays here, at the top. */
export function HomePanels({ first, player, feed }) {
  const clan = panelOf(useHomeClan(), "clan");
  const needs = panelOf(useHomeNeeds(), "needs");
  const actions = actionsFrom({ clan, needs });
  const unlock = actions?.ok ? actions.unlock : null;
  // Home's suggested follows (2026-11-13), for an account that follows
  // few players, on every visit until it follows more: read apart from the
  // feed, first in the main column so a phone's first screen holds them.
  // While they list people they are the people to follow, so the side
  // panel steps aside rather than say the same names twice.
  const offered = offersStarter(first);
  const starter = usePeople("starter", offered);
  // A read kept from before the fifth follow is not an offer any more.
  const starterShown =
    offered && Boolean(starter.data?.ok && starter.data.offer);
  const starterListed = starterShown && starter.data.people?.length > 0;
  return (
    <div className="kit-home">
      {unlock ? <Unlock player={player} /> : null}
      <div className="kit-home__two">
        <div className="kit-home__main">
          {starterShown ? <StarterSet query={starter} /> : null}
          <Welcome first={first} player={player} />
          {feed}
        </div>
        <div className="kit-home__side">
          <YourWeek player={player} />
          <ClanPanel clan={clan} player={player} />
          {starterListed ? null : <PeopleToFollow />}
          <DigestPanel first={first} />
        </div>
      </div>
    </div>
  );
}

function Unlock({ player }) {
  return (
    <p className="kit-notice">
      <span>
        Elixir has {player.name} as yours but hasn&rsquo;t confirmed it. Prove
        it with one battle to act as your clan&rsquo;s Leader here.
      </span>
      <Link to={`${SETTINGS}/players/verify`}>Verify {player.name}</Link>
    </p>
  );
}

const signedRecord = (r) => `${r.wins}${DASH}${r.losses}`;

function YourWeek({ player }) {
  const { when, clock } = useClock();
  const [chosen, setChosen] = useState(null);
  const initial = panelOf(useHomeWeek(null), "week");
  const asked = panelOf(useHomeWeek(chosen, Boolean(chosen)), "week");
  const week = chosen ? asked : initial;
  const failed = week?.ok === false;
  const modes = week?.modes ?? initial?.modes ?? {};
  const open = chosen ?? week?.mode ?? "ladder";
  const link = ladderHref("season", { player: player.player_tag, mode: open });
  // Cheers received this week (G4) are every mode's: the opening read counts
  // them. Null when unread or not countable just now: shown as nothing.
  const cheers = initial?.cheers ?? null;
  return (
    <Panel
      title="Your week"
      action={<Link to={link}>Open in Stats</Link>}
      className="kit-week"
      pad
    >
      <Chips
        label="Mode"
        options={weekChips(modes)}
        // No chip lit until the week says which mode it opens on.
        value={chosen ?? (initial === undefined ? null : open)}
        onChange={setChosen}
      />
      {failed ? (
        <p className="kit-week__quiet" role="alert">
          Your week could not be read just now. Try again shortly.
        </p>
      ) : !week ? (
        <div className="kit-skeleton" aria-busy="true" />
      ) : week.record.battles === 0 ? (
        <p className="kit-week__quiet">
          No battles in {modeWord(open)} this week.
          {week.last_battle_at
            ? ` Your last one was ${when(week.last_battle_at)}.`
            : ""}
          {cheers ? ` ${cheersWords(cheers)} since Monday.` : ""}
        </p>
      ) : (
        <>
          <Stats>
            <Stat
              label="Record"
              value={signedRecord(week.record)}
              note={`${week.record.battles} ${week.record.battles === 1 ? "battle" : "battles"} since Monday`}
            />
            {week.trophies != null ? (
              <Stat
                label="Trophies"
                value={week.trophies.toLocaleString("en-US")}
                note={trophyNote(week.net_trophies, player, clock)}
              />
            ) : week.net_trophies != null ? (
              <Stat
                label="Trophies"
                value={signed(week.net_trophies)}
                note="in recorded battles"
              />
            ) : null}
            {cheers != null ? (
              <Stat
                label="Cheers"
                value={cheers}
                note="from others on your items since Monday"
              />
            ) : null}
          </Stats>
          {week.deck ? (
            <div className="kit-deck">
              <div className="kit-deck__head">
                <span className="kit-deck__name">
                  {week.deck.label ?? "Most played deck"}
                </span>
                <span className="kit-deck__note">
                  Most played, {week.deck.battles} battles
                </span>
              </div>
              <DeckGrid
                cards={week.deck.cards}
                size={56}
                columns={8}
                showLevel={false}
                label={week.deck.label ?? "Most played deck"}
              />
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
const cheersWords = (n) => `${n} ${n === 1 ? "cheer" : "cheers"} from others`;

function trophyNote(net, player, clock) {
  const asOf = player.battlelog_observed_at
    ? `as of ${clock(player.battlelog_observed_at)}`
    : null;
  if (net == null) return asOf ?? undefined;
  return `${signed(net)} in recorded battles${asOf ? `, ${asOf}` : ""}`;
}

function ClanPanel({ clan, player }) {
  const invalidate = useInvalidate();
  if (clan === undefined)
    return (
      <Panel title="Your clan" pad>
        <div className="kit-skeleton" aria-busy="true" />
      </Panel>
    );
  if (!clan.ok)
    return (
      <Panel title="Your clan" pad>
        <p className="kit-week__quiet" role="alert">
          Your clans could not be read just now. Your saved follows are
          unchanged.
        </p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => invalidate(["me", "home", "clan"])}
        >
          Try again
        </button>
      </Panel>
    );
  if (clan.state === "none")
    return (
      <Panel title="Your clan">
        <Empty title={`${player.name} isn’t in a clan right now`}>
          When Elixir sees {player.name} join one, it starts following that
          clan.
        </Empty>
      </Panel>
    );
  if (clan.state === "untracked") return <FollowHomeClan clan={clan} />;
  const base = `/clan/${tagPath(clan.clan_tag)}/feed`;
  const race = lastRaceLine(clan.last_race);
  const now = raceNowLine(clan.race_now);
  return (
    <Panel
      title={clan.name ?? "Your clan"}
      action={<Link to={base}>Open Clan</Link>}
      className="kit-panel--clan"
    >
      <Rows>
        {now ? (
          <Row
            title="This week’s race"
            detail={
              <>
                {now}
                {clan.race_now?.day_kind === "war" &&
                !clan.race_now.finished ? (
                  <RacePlace rank={clan.race_now.place} />
                ) : null}
              </>
            }
          />
        ) : null}
        {race ? <Row title="Last race" right={race} /> : null}
        {clan.war_decks ? (
          <Row
            title="Your war decks this week"
            right={
              clan.war_decks.open
                ? clan.war_decks.decks
                : `${clan.war_decks.decks} of ${clan.war_decks.asked}`
            }
          />
        ) : null}
        {clan.donations != null ? (
          <Row title="Your donations this week" right={clan.donations} />
        ) : null}
        {clan.standing && !LEADS.has(clan.role) ? (
          <Row
            title="Your standing"
            right={STANDING[clan.standing] ?? clan.standing}
          />
        ) : null}
        {clan.clock ? (
          <Row
            title="Days since your last battle"
            detail={`This clan counts a member at risk from ${clan.clock.at_risk_days} days.`}
            right={clan.clock.days_idle}
          />
        ) : null}
      </Rows>
    </Panel>
  );
}

function FollowHomeClan({ clan }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const name = clan.name ?? clan.clan_tag;
  return (
    <Panel title="Your clan" pad>
      <Empty title="Your player’s clan isn’t followed yet">
        Follow it to record its roster, who joins and who goes, and its races.
      </Empty>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const res = await api.myClanAction({
            action: "add",
            clan_tag: clan.clan_tag,
            scope: "activity",
          });
          setBusy(false);
          // The API's own message names the tier and the slot.
          if (!res.ok)
            return setErr(res.data?.message ?? "That did not work. Try again.");
          invalidate();
        }}
      >
        Follow <TagText>{name}</TagText>
      </button>
      {err ? (
        <p className="kit-form__err" role="alert">
          {err}
        </p>
      ) : null}
    </Panel>
  );
}

/** Home's welcome steps (G4, 2026-11-12): what a new account has left to
 *  do, until all four are done; then nothing, in place of the folded Setup
 *  details. Worked out from the first answer each time (logic.js). Compact
 *  since the design canvas of 2026-11-13: one line a step, its way in at
 *  the right, and the count at the head's right. */
function Welcome({ first, player }) {
  const state = welcomeSteps(first);
  if (!state || state.all) return null;
  const name = player.name ?? player.player_tag;
  const following = first.welcome.following ?? 0;
  return (
    <section
      className="kit-welcome kit-welcome--compact"
      aria-labelledby="kit-welcome-head"
    >
      <h2
        id="kit-welcome-head"
        // A flex row reads each part as its own word, so the head says
        // its sentence whole.
        aria-label={`Welcome to Elixir, ${state.done} of ${state.total} done`}
      >
        <span>Welcome to Elixir</span>
        <span className="kit-welcome__count">
          {state.done} of {state.total} done
        </span>
      </h2>
      <ol className="kit-checks">
        <Check
          n={1}
          title="Add your player"
          done={state.steps.player}
          line={
            state.steps.player ? (
              <>
                <TagText>{name}</TagText>, your main player.
              </>
            ) : null
          }
        />
        <Check
          n={2}
          title="Verify it’s you"
          done={state.steps.verify}
          line={
            state.steps.verify
              ? `${name} is verified.`
              : "Play one battle with the deck Elixir names. Win or lose, it counts."
          }
          to={`${SETTINGS}/players/verify`}
          go="Verify"
          goName={`Verify ${name}`}
        />
        <Check
          n={3}
          title="Follow a few people"
          done={state.steps.follow}
          line={
            state.steps.follow
              ? `You follow ${following} ${following === 1 ? "player" : "players"}.`
              : "Their battles and big moments fill your feed."
          }
          to="/home/find"
          go="Find"
          goName="Find people"
        />
        <Check
          n={4}
          title="Choose your digest"
          done={state.steps.digest}
          line={
            state.steps.digest
              ? digestLine(first.welcome.digest)
              : "Your friends in one email. Weekly, daily or off: your call."
          }
          to={`${SETTINGS}/emails`}
          go="Choose"
          goName="Choose your digest"
        />
      </ol>
    </section>
  );
}

/** One welcome step on one line (canvas .onb): its dot, what it is, a line
 *  that says what is done or why, and its way in while it is not done. */
function Check({ n, title, done, line, to = null, go = null, goName = null }) {
  return (
    <li className={`kit-check${done ? " kit-step--done" : ""}`}>
      <span className="kit-step__dot" aria-hidden="true">
        {done ? "✓" : n}
      </span>
      <div className="kit-check__body">
        <h3>{title}</h3>
        {line ? <p>{line}</p> : null}
      </div>
      {!done && to ? (
        <Link to={to} className="btn btn--sm" aria-label={goName ?? undefined}>
          {go}
        </Link>
      ) : null}
    </li>
  );
}

/** Your digest, chosen here as on Settings' Emails (design canvas
 *  2026-11-13): one write to the same row, so choosing here completes the
 *  welcome step too. The default is weekly; choosing the one already lit
 *  saves it, which is how a person chooses the default. */
function DigestPanel({ first }) {
  const queryClient = useQueryClient();
  const write = useWrite(api.setDigest, {
    invalidate: async () => {
      // The welcome's count and Settings' Emails, not the rest of Home.
      await queryClient.invalidateQueries({
        queryKey: ["me", "home"],
        exact: true,
      });
      await queryClient.invalidateQueries({ queryKey: keys.email });
    },
  });
  const [picked, setPicked] = useState(null);
  if (!first?.welcome) return null;
  const value = picked ?? digestChoice(first.welcome.digest);
  return (
    <Panel title="Your digest" pad className="kit-digest">
      <p className="kit-digest__line">
        {value === "off" ? (
          <>
            <b>Off.</b> Your feed is still here.
          </>
        ) : (
          <>
            Comes <b>{digestWhen(value)}</b>: the people you follow and your
            clan&rsquo;s week, in one email. Skipped when there is no news.
          </>
        )}
      </p>
      <Chips
        label="How often your digest comes"
        options={DIGEST_CHOICES}
        value={value}
        onChange={async (v) => {
          if (write.busy) return;
          const before = picked;
          setPicked(v);
          const res = await write.run(v);
          if (!res.ok) setPicked(before);
        }}
      />
      <WriteError error={write.error} className="field-error" />
    </Panel>
  );
}

/** The chip's words: what the age of the read means for this page. */
export function TodayFresh({ player }) {
  const { when } = useClock();
  const ts = player?.battlelog_observed_at ?? null;
  return (
    <FreshChip ts={ts}>
      {ts
        ? `Your battle log was last read ${when(ts)}. `
        : // Not read yet: what is on record came from elsewhere (a battle
          // against someone Elixir records), and this page checks again.
          "Your profile and about your last 30 battles usually show up within a minute (a few at busy times). "}
      The game only keeps about your last 30 battles, so a long session between
      reads can leave a gap. A gap means Elixir didn&rsquo;t see those battles,
      not that you didn&rsquo;t play.
    </FreshChip>
  );
}

export function TodayError({ onRetry, busy }) {
  return (
    <ErrorState title="Home didn’t load" onRetry={onRetry} busy={busy}>
      Try again in a moment. Nothing was lost.
    </ErrorState>
  );
}
