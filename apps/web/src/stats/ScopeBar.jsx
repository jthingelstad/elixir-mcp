import {
  FreshChip,
  Chips,
  PageHead,
  Tabs,
  useClock,
  noun,
} from "@elixir-mcp/ui";
import { useId } from "react";
import {
  STATS_PAGES,
  fmt,
  isOwnClaim,
  modeChips,
  modeWords,
  playerName,
  seasonHead,
} from "./stats.js";
import { SeasonFallback, useSeasonEdge, WarLine } from "./common.jsx";
import { ZoneOffer } from "../components/ZoneOffer.jsx";

/**
 * Every Stats tab's frame (redesign step 5, 2026-11-06): the head, the scope
 * bar, the tabs, then the callouts in the board's order. The frame stays when a
 * read fails, so a person can still change player, season or mode.
 */
export function StatsFrame({
  slug,
  player,
  players,
  mode,
  season,
  seasons,
  scope,
  summary,
  hrefFor,
  navigate,
  children,
}) {
  const body = scope.data;
  const clan = summary.data?.clan ?? null;
  return (
    <div className="stats-page">
      <FrameHead
        slug={slug}
        player={player}
        clanName={clan?.name ?? null}
        mode={mode}
        season={season}
        applied={body?.applied}
      />
      <ScopeBar
        player={player}
        players={players}
        mode={mode}
        modes={body?.window?.modes}
        season={season}
        seasons={seasons}
        observedAt={body?.meta?.source_polls?.player_battlelog?.observed_at}
        hrefFor={hrefFor}
        navigate={navigate}
      />
      <Tabs
        label="Stats"
        value={slug}
        items={STATS_PAGES.map((p) => ({
          key: p.slug,
          label: p.label,
          href: hrefFor({ slug: p.slug }),
        }))}
      />
      <div className="stats-stack">
        <ZoneOffer />
        <SeasonFallback season={season} hrefFor={hrefFor} />
        {mode === "war" && season.current ? (
          <WarLine
            player={player}
            clan={clan}
            seasonWar={seasonHead(body?.applied).war}
            full={slug === "season"}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

function FrameHead({ slug, player, clanName, mode, season, applied }) {
  const edge = useSeasonEdge();
  const head = seasonHead(applied);
  const name = applied ? head.name : season.name;
  const who = playerName(player);
  if (slug !== "season") {
    const page = STATS_PAGES.find((p) => p.slug === slug)?.label;
    return (
      <PageHead
        className="stats-head"
        title={page}
        sub={`${who} · ${name}, ${modeWords(mode)}`}
      />
    );
  }
  const place = [who, clanName].filter(Boolean).join(" · ");
  let span = "";
  if (head.running && head.endsAt)
    span = `${
      head.age == null
        ? ""
        : head.age < 1
          ? "Less than a day in. "
          : `${fmt(head.age)} ${noun(head.age, "day")} in. `
    }The season ends ${edge(head.endsAt)}.`;
  else if (head.startsAt && head.endsAt)
    span = `The season ran ${edge(head.startsAt)} to ${edge(head.endsAt)}.`;
  return (
    <PageHead
      className="stats-head"
      title={name}
      sub={span ? `${place} · ${span}` : place}
    />
  );
}

/** A closed select shows only the name; what kind of choice it is belongs to
 *  the open menu. A group with nothing in it is not drawn. */
function OptionGroups({ groups, option }) {
  return groups
    .filter(([, list]) => list.length)
    .map(([label, list]) => (
      <optgroup key={label} label={label}>
        {list.map(option)}
      </optgroup>
    ));
}

/** Whose season: a list with several players, a name and a tag with one. The
 *  scope bar's, and Pending's, where nothing else on the page can change it. */
export function PlayerPick({ player, players, hrefFor, navigate }) {
  const id = useId();
  if (players.length < 2)
    return (
      <span className="stats-scope__one">
        {playerName(player)}{" "}
        <span className="mono-tag stats-scope__tag">{player.player_tag}</span>
      </span>
    );
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Player
      </label>
      <select
        id={id}
        className="scope-select"
        value={player.player_tag}
        onChange={(e) => {
          const next = players.find((p) => p.player_tag === e.target.value);
          navigate(
            hrefFor({ player: next?.is_primary ? null : e.target.value }),
          );
        }}
      >
        <OptionGroups
          groups={[
            ["Your main player", players.filter((p) => p.is_primary)],
            ["Also you", players.filter((p) => !p.is_primary && isOwnClaim(p))],
            ["Following", players.filter((p) => !isOwnClaim(p))],
          ]}
          option={(p) => (
            <option key={p.player_tag} value={p.player_tag}>
              {playerName(p)}
            </option>
          )}
        />
      </select>
    </>
  );
}

/** Whose season, which season, which game, and how fresh. Each choice is an
 *  address: a link, a reload or a mail keeps it. A player you follow is in
 *  the list only when their player page opened Stats for them. */
function ScopeBar({
  player,
  players,
  mode,
  modes,
  season,
  seasons,
  observedAt,
  hrefFor,
  navigate,
}) {
  const { when } = useClock();
  const seasonId = useId();
  const listed = seasons ?? [];
  const options = listed.some((s) => s.key === season.key)
    ? listed
    : [...listed, { key: season.key, name: season.name }];
  return (
    <div className="stats-scope stats-scope--frame">
      <div className="stats-scope__picks">
        <PlayerPick
          player={player}
          players={players}
          hrefFor={hrefFor}
          navigate={navigate}
        />
        <label className="sr-only" htmlFor={seasonId}>
          Season
        </label>
        <select
          id={seasonId}
          className="scope-select"
          value={season.key}
          onChange={(e) => navigate(hrefFor({ season: e.target.value }))}
        >
          <OptionGroups
            groups={[
              ["This season", options.filter((s) => s.current)],
              ["Earlier", options.filter((s) => !s.current)],
            ]}
            option={(s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            )}
          />
        </select>
      </div>
      <Chips
        label="Mode"
        className="stats-scope__modes"
        value={mode}
        options={modeChips(modes, mode)}
        onChange={(key) => navigate(hrefFor({ mode: key }))}
      />
      {observedAt ? (
        <FreshChip ts={observedAt} className="stats-scope__fresh">
          {playerName(player)}&rsquo;s battle log was last read at{" "}
          {when(observedAt)}. The game keeps about the last 30 battles, so a
          long session between reads can leave a gap. A gap means unknown. It
          does not mean no battles.
        </FreshChip>
      ) : null}
    </div>
  );
}
