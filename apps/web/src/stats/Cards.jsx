import { CardArt, noun, Panel, Empty, Row, Rows } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import {
  OTHER,
  fmt,
  modeLabel,
  modeWords,
  pct,
  readModes,
  seasonWords,
} from "./stats.js";
import { cardRows, modeBattles } from "./stats-cards.js";
import { useToolRead } from "../lib/queries.js";
import { Loading, ReadError, Record } from "./common.jsx";
import { useWhose } from "./whose.js";

/** Rows a card list shows before "Show all". */
const ROWS_SHOWN = 12;

/**
 * The Cards tab answers one question (Jamie, 2026-11-14): the cards you
 * played, and the cards you faced, in one mode this season. Both lists come
 * from battles_cards (mine and opponent), each row the record of the battles
 * where that deck held the card, in the tool's order (most battles first). A
 * form is its own row, as the tool keeps it; no row is summed with another.
 * Each mode is read on its own and named on the page: Other is Challenge and
 * Tournament, read apart. No order choice, level gap or opponent list: they
 * answered other questions and are gone.
 */
export function Cards({ player, mode, modeReady, season }) {
  return (
    <>
      {readModes(mode).map((m) => (
        <ModeCards
          key={m}
          player={player}
          mode={m}
          chip={mode}
          modeReady={modeReady}
          season={season}
        />
      ))}
    </>
  );
}

function ModeCards({ player, mode, chip, modeReady, season }) {
  const whose = useWhose();
  const args = { player_tag: player.player_tag, season: season.arg, mode };
  const mine = useToolRead(
    "battles_cards",
    { ...args, perspective: "mine" },
    { enabled: modeReady },
  );
  const theirs = useToolRead(
    "battles_cards",
    { ...args, perspective: "opponent" },
    { enabled: modeReady },
  );
  const when = seasonWords(season);
  const battles = Number(modeBattles(mine.data, mode) ?? 0);
  if (!modeReady || mine.isPending)
    return <Loading what={`${whose.your} cards`} />;
  if (mine.isError)
    return <ReadError query={mine} what={`${whose.your} cards`} />;
  if (!battles)
    return chip === OTHER.key ? null : (
      <Empty title={`No ${modeWords(mode)} battles ${when}`} titleAs="h2">
        {season.current
          ? "Elixir has recorded none in this mode since the season began,"
          : `Elixir recorded none in this mode in ${season.name},`}{" "}
        so there are no cards to read back. Another chip may hold {whose.your}{" "}
        season.
      </Empty>
    );
  // The mode is named on every panel, so no list reads as all games.
  const scope = `${fmt(battles)} ${modeLabel(mode)} ${noun(battles, "battle")}`;
  return (
    <>
      <CardList
        title={`Cards ${whose.you} played`}
        scope={scope}
        rows={cardRows(mine.data)}
        floor={mine.data?.applied?.min_battles}
        foot={`${whose.Your} record in the battles where ${whose.your} deck held the card. A card in more than one deck counts all their battles, so the rows overlap.`}
      />
      {theirs.isPending ? (
        <Loading what={`the cards ${whose.you} faced`} />
      ) : theirs.isError ? (
        <ReadError query={theirs} what={`the cards ${whose.you} faced`} />
      ) : (
        <CardList
          title={`Cards ${whose.you} faced`}
          scope={scope}
          rows={cardRows(theirs.data)}
          floor={theirs.data?.applied?.min_battles}
          foot={`${whose.Your} record in the battles where the opponent's deck held the card.`}
        />
      )}
    </>
  );
}

/** One list: a row per card and form, its art, its battles and the
 *  record. The name is the one link, to the card's public page (a tower
 *  troop has none), and its tap covers the row. Art keeps its own pixels;
 *  only CSS sizes it. */
function CardList({ title, scope, rows, floor, foot }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return (
    <Panel
      title={title}
      titleId={id}
      action={<span className="stats-aside">{scope}</span>}
      aria-labelledby={id}
    >
      {rows.length ? (
        <Rows className="stats-cardrows">
          {shown.map((r) => (
            <Row
              key={r.key}
              lead={<CardArt card={r.card} size={40} showLevel={false} />}
              className={r.href ? "kit-row--target" : undefined}
              title={
                r.href ? (
                  // A site page, not the app's: the browser follows it.
                  <a className="kit-row__link" href={r.href}>
                    {r.label}
                  </a>
                ) : (
                  r.label
                )
              }
              detail={`${fmt(r.battles)} ${noun(r.battles, "battle")}${r.rate != null ? ` · ${pct(r.rate)} won` : ""}`}
              right={<Record wins={r.wins} losses={r.losses} />}
            />
          ))}
        </Rows>
      ) : (
        <div className="panel__body">
          <p className="text-ink-faint">
            No card reached the lowest it can show.
          </p>
        </div>
      )}
      {rows.length > ROWS_SHOWN ? (
        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all
              ? `Show the first ${ROWS_SHOWN}`
              : `Show all ${fmt(rows.length)}`}
          </button>
        </div>
      ) : null}
      <div className="panel__foot">
        {foot}
        {floor
          ? ` Cards in fewer than ${fmt(floor)} ${noun(floor, "battle")} are left out.`
          : ""}
      </div>
    </Panel>
  );
}
