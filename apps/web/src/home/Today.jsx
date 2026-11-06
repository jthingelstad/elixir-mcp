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
import { ladderHref } from "../ladder/ladder.js";
import { SETTINGS } from "../lib/settings.js";
import { tagPath } from "../lib/tag-url.js";
import {
  useHomeClan,
  useHomeLatest,
  useHomeNeeds,
  useHomeWeek,
  useInvalidate,
} from "../lib/queries.js";
import {
  LEADS,
  STANDING,
  actionsFrom,
  lastRaceLine,
  modeWord,
  needsYou,
  panelOf,
  weekChips,
} from "./logic.js";

const DASH = "–";

/** Home › Today's panels, in the order they read. Each reads for itself and
 *  draws its own loading state; a panel that failed says so, the rest render.
 *  Needs you has its own read, ahead of the card's slower one, and takes no room
 *  until it has something to say, so when it comes late it opens rather than
 *  jumps. */
export function TodayPanels({ first, me, player }) {
  const clock = useClock();
  const clan = panelOf(useHomeClan(), "clan");
  const needs = panelOf(useHomeNeeds(), "needs");
  const [late] = useState(needs === undefined);
  const { rows, more } = needsYou({ clan, needs, signals: me?.signals, clock });
  const actions = actionsFrom({ clan, needs });
  const unlock = actions?.ok ? actions.unlock : null;
  return (
    <div className="kit-home">
      {unlock || rows.length > 0 ? (
        <div className={`kit-home__top${late ? " kit-home__top--late" : ""}`}>
          <div className="kit-home__top-in">
            {unlock ? <Unlock player={player} /> : null}
            {rows.length > 0 ? <NeedsYou rows={rows} more={more} /> : null}
          </div>
        </div>
      ) : null}
      <div className="kit-home__two">
        <YourWeek player={player} />
        <div className="kit-home__side">
          <ClanPanel clan={clan} player={player} />
          <Latest />
        </div>
      </div>
      <SetupDetails first={first} clan={clan} player={player} />
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

function NeedsYou({ rows, more }) {
  return (
    <Panel title="Needs you" className="kit-needs">
      <Rows>
        {rows.map((r) => (
          <Row
            key={r.key}
            title={<TagText>{r.title}</TagText>}
            detail={r.detail}
            right={
              <Link to={r.to} className="btn btn--sm">
                {r.cta}
              </Link>
            }
          />
        ))}
        {more ? <Row quiet href={more.to} title={more.title} /> : null}
      </Rows>
    </Panel>
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
  return (
    <Panel
      title="Your week"
      action={<Link to={link}>Open in Ladder</Link>}
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
          Your clans could not be read just now. Your saved tracking is
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
  const base = `/clan/${tagPath(clan.clan_tag)}`;
  const race = lastRaceLine(clan.last_race);
  return (
    <Panel
      title={clan.name ?? "Your clan"}
      action={<Link to={base}>Open Clan</Link>}
    >
      <Rows>
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
      <Empty title="Your player’s clan isn’t tracked yet">
        Track it to record its roster, who joins and who goes, and its races.
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
        Start tracking <TagText>{name}</TagText>
      </button>
      {err ? (
        <p className="kit-form__err" role="alert">
          {err}
        </p>
      ) : null}
    </Panel>
  );
}

function Latest() {
  const { when } = useClock();
  const latest = panelOf(useHomeLatest(), "latest");
  const items = latest?.items ?? [];
  return (
    <Panel title="Latest" action={<Link to="/home/timeline">All of it</Link>}>
      {latest === undefined ? (
        <div className="kit-skeleton" aria-busy="true" />
      ) : !latest.ok ? (
        <p className="kit-week__quiet" role="alert">
          The timeline could not be read just now. Try again shortly.
        </p>
      ) : items.length === 0 ? (
        <p className="kit-week__quiet">Nothing in the last seven days.</p>
      ) : (
        <Rows>
          {items.map((it, i) => (
            <Row
              key={it.id ?? i}
              title={<TagText>{it.text}</TagText>}
              right={when(it.at)}
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}

function SetupDetails({ first, clan, player }) {
  const { whenDay } = useClock();
  const conn = first?.connection;
  const tracked = first?.clan;
  return (
    <details className="kit-setup">
      <summary>Setup details</summary>
      <Rows>
        <Row
          title="Your player"
          right={
            <>
              <TagText>{player.name}</TagText>, your main player
            </>
          }
        />
        <Row
          title="Recording"
          right={<FreshInline ts={player.battlelog_observed_at} />}
        />
        <Row
          title="Proved it’s you"
          right={
            player.verified ? (
              player.verified_at ? (
                `Verified ${whenDay(player.verified_at)}`
              ) : (
                "Verified"
              )
            ) : (
              <Link to={`${SETTINGS}/players/verify`}>
                Not yet. One battle proves it.
              </Link>
            )
          }
        />
        <Row
          title="Your clan"
          right={
            tracked?.name
              ? `${tracked.name}${tracked.war_weeks ? `, ${tracked.war_weeks} race ${tracked.war_weeks === 1 ? "week" : "weeks"}` : ""}`
              : clan === undefined
                ? null
                : clan.ok && clan.state === "none"
                  ? "None right now"
                  : "Not tracked yet"
          }
        />
        <Row
          title="Connected AI"
          right={
            (conn?.active_connections ?? 0) > 0 ? (
              <Link to={`${SETTINGS}/connections`}>
                {conn.active_connections}{" "}
                {conn.active_connections === 1 ? "connection" : "connections"}
              </Link>
            ) : (
              "No connections yet"
            )
          }
        />
      </Rows>
    </details>
  );
}

function FreshInline({ ts }) {
  const { when } = useClock();
  return ts ? `Battle log read ${when(ts)}` : "Battle log not read yet";
}

/** The chip's words: what the age of the read means for this page. */
export function TodayFresh({ player }) {
  const { when } = useClock();
  const ts = player?.battlelog_observed_at ?? null;
  return (
    <FreshChip ts={ts}>
      {ts ? `Your battle log was last read ${when(ts)}. ` : ""}
      The game keeps about your last 30 battles, so a long session between reads
      can leave a gap. A gap means unknown. It does not mean you didn&rsquo;t
      play.
    </FreshChip>
  );
}

export function TodayError({ onRetry, busy }) {
  return (
    <ErrorState
      title="Today could not be read just now"
      onRetry={onRetry}
      busy={busy}
    >
      Try again shortly. Nothing was lost.
    </ErrorState>
  );
}
