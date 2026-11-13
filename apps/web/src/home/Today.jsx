import { useState } from "react";
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
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { PeopleToFollow } from "./People.jsx";
import { Step } from "./NewAccount.jsx";
import { ladderHref } from "../ladder/ladder.js";
import { SETTINGS } from "../lib/settings.js";
import { tagPath } from "../lib/tag-url.js";
import {
  useHomeClan,
  useHomeNeeds,
  useHomeWeek,
  useInvalidate,
} from "../lib/queries.js";
import {
  LEADS,
  STANDING,
  actionsFrom,
  digestLine,
  lastRaceLine,
  modeWord,
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
  return (
    <div className="kit-home">
      {unlock ? <Unlock player={player} /> : null}
      <div className="kit-home__two">
        <div className="kit-home__main">
          <Welcome first={first} player={player} />
          {feed}
        </div>
        <div className="kit-home__side">
          <YourWeek player={player} />
          <ClanPanel clan={clan} player={player} />
          <PeopleToFollow />
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
  if (clan.state === "untracked") return <TrackClan clan={clan} />;
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
        {now ? <Row title="This week’s race" detail={now} /> : null}
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

function TrackClan({ clan }) {
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
 *  details. Worked out from the first answer each time (logic.js). */
function Welcome({ first, player }) {
  const state = welcomeSteps(first);
  if (!state || state.all) return null;
  const name = player.name ?? player.player_tag;
  const following = first.welcome.following ?? 0;
  return (
    <section className="kit-welcome" aria-labelledby="kit-welcome-head">
      <h2 id="kit-welcome-head">
        Welcome to Elixir
        <span className="kit-welcome__count">
          , {state.done} of {state.total} done
        </span>
      </h2>
      <ol className="kit-steps">
        <Step
          n={1}
          heading="h3"
          title="Add your player"
          done={state.steps.player}
          doneLine={
            <>
              <TagText>{name}</TagText>, your main player.
            </>
          }
        />
        <Step
          n={2}
          heading="h3"
          title="Verify it’s you"
          done={state.steps.verify}
          doneLine={`${name} is verified.`}
        >
          Play one battle with a deck Elixir names, win or lose.{" "}
          <Link to={`${SETTINGS}/players/verify`}>Verify {name}</Link>
        </Step>
        <Step
          n={3}
          heading="h3"
          title="Follow a few people"
          done={state.steps.follow}
          doneLine={`You follow ${following} ${following === 1 ? "player" : "players"}.`}
        >
          Their battles and moments fill your feed.{" "}
          <Link to="/home/find">Find people</Link>
        </Step>
        <Step
          n={4}
          heading="h3"
          title="Choose your digest"
          done={state.steps.digest}
          doneLine={digestLine(first.welcome.digest)}
        >
          The people you follow in one email, weekly unless you choose daily or
          off. <Link to={`${SETTINGS}/emails`}>Choose your digest</Link>
        </Step>
      </ol>
    </section>
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
          "Your profile and roughly your last 30 battles usually arrive within a minute; at busy times it can take a few. "}
      The game keeps about your last 30 battles, so a long session between reads
      can leave a gap. A gap means unknown. It does not mean you didn&rsquo;t
      play.
    </FreshChip>
  );
}

export function TodayError({ onRetry, busy }) {
  return (
    <ErrorState
      title="Home could not be read just now"
      onRetry={onRetry}
      busy={busy}
    >
      Try again shortly. Nothing was lost.
    </ErrorState>
  );
}
