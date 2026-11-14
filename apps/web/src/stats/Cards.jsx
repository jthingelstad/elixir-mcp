import { PlayerName } from "@elixir-mcp/ui";
import {
  CardArt,
  Chips,
  Link,
  noun,
  Tag,
  Panel,
  Empty,
  Table,
} from "@elixir-mcp/ui";
import { useId, useState } from "react";
import {
  OTHER,
  fmt,
  modeLabel,
  modeWords,
  pct,
  readModes,
  seasonWords,
  signed,
} from "./stats.js";
import {
  ORDERS,
  cameBack,
  cardRows,
  distinctCards,
  modeBattles,
  opponentName,
  pickOrder,
  times,
} from "./stats-cards.js";
import { useToolRead } from "../lib/queries.js";
import { playerHref } from "../lib/player.js";
import { useNav } from "../App.jsx";
import { Loading, ReadError, Record } from "./common.jsx";
import { useWhose } from "./whose.js";

/** Rows a card table shows before "Show all". */
const ROWS_SHOWN = 12;

/** The fewest meetings an opponent needs to be listed: met again. */
const OPPONENT_FLOOR = 2;

/**
 * The Cards tab: one chip's season, card by card. Your cards and the cards
 * across the table come from battles_cards (mine and opponent), each a record of
 * the battles where that deck held the card; the opponents are battles_opponents'
 * count and its repeats. A form is its own row, as the tool keeps it; no row is
 * summed with another. What you faced reads in the tools' default order (most
 * battles first) unless the reader asks for most losses first (`?order=losses`,
 * the tools' `sort: "losses"`). Other is Challenge and Tournament, read apart.
 */
export function Cards({ player, mode, modeReady, season, search, hrefFor }) {
  const navigate = useNav();
  const order = pickOrder(search.order);
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
          order={order}
          onOrder={(o) => navigate(hrefFor({ order: o }))}
        />
      ))}
    </>
  );
}

function ModeCards({ player, mode, chip, modeReady, season, order, onOrder }) {
  const whose = useWhose();
  const args = { player_tag: player.player_tag, season: season.arg, mode };
  // Only a chosen order rides on the read, so the default read is the
  // one the page always made (and shares its cache).
  const sorted = order === "losses" ? { sort: "losses" } : {};
  const mine = useToolRead(
    "battles_cards",
    { ...args, perspective: "mine" },
    { enabled: modeReady },
  );
  const theirs = useToolRead(
    "battles_cards",
    { ...args, perspective: "opponent", ...sorted },
    { enabled: modeReady },
  );
  const opponents = useToolRead(
    "battles_opponents",
    { ...args, min_battles: OPPONENT_FLOOR, ...sorted },
    { enabled: modeReady },
  );
  const label = modeLabel(mode);
  const when = seasonWords(season);
  const played = Number(modeBattles(mine.data, mode) ?? 0) > 0;
  if (!modeReady || mine.isPending)
    return <Loading what={`${whose.your} cards`} />;
  if (mine.isError)
    return <ReadError query={mine} what={`${whose.your} cards`} />;
  if (!played)
    return chip === OTHER.key ? null : (
      <Empty title={`No ${modeWords(mode)} battles ${when}`} titleAs="h2">
        {season.current
          ? "Elixir has recorded none in this mode since the season began,"
          : `Elixir recorded none in this mode in ${season.name},`}{" "}
        so there are no cards to read back. Another chip may hold {whose.your}{" "}
        season.
      </Empty>
    );
  return (
    <>
      <YourCards body={mine.data} label={label} other={chip === OTHER.key} />
      <div className="stats-order">
        <Chips
          label={`Order what ${whose.you} faced`}
          options={ORDERS}
          value={order}
          onChange={onOrder}
        />
        <span className="stats-order__hint">
          {order === "losses"
            ? "Most battles lost first, then most battles."
            : "Most battles first."}{" "}
          A card is listed from{" "}
          {fmt(
            theirs.data?.applied?.min_battles ??
              mine.data?.applied?.min_battles ??
              1,
          )}{" "}
          battles, a player from {fmt(OPPONENT_FLOOR)}.
        </span>
      </div>
      <TheirCards
        read={theirs}
        opponents={opponents.data?.distinct_opponents ?? null}
        mode={mode}
        order={order}
      />
      <Opponents read={opponents} label={label} when={when} order={order} />
    </>
  );
}

/** A level gap as the tools state it: "+0.40", "−1.25", or a dash where
 *  the record has no levels. */
const gapText = (gap) => (gap == null ? "—" : signed(Number(gap), 2));

/** A card's cell: its art, never a link, and its name, the one link. */
function CardCell({ row }) {
  return (
    <span className="stats-card">
      <CardArt card={row.card} size={36} showLevel={false} />
      {row.href ? (
        <a className="stats-card__name" href={row.href}>
          {row.label}
        </a>
      ) : (
        <span className="stats-card__name">{row.label}</span>
      )}
    </span>
  );
}

/** "Show all 43" under a long table, as a toggle in place. */
function useShown(rows) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  const toggle =
    rows.length > ROWS_SHOWN ? (
      <div className="panel__foot">
        <button
          type="button"
          className="btn btn--sm btn--quiet"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all
            ? `Show the first ${ROWS_SHOWN}`
            : `Show all ${fmt(rows.length)} rows`}
        </button>
      </div>
    ) : null;
  return { shown, toggle };
}

function YourCards({ body, label, other }) {
  const whose = useWhose();
  const id = useId();
  const rows = cardRows(body);
  const { shown, toggle } = useShown(rows);
  const floor = body?.applied?.min_battles;
  return (
    <Panel
      title={other ? `${whose.Your} cards in ${label}` : `${whose.Your} cards`}
      titleId={id}
      action={
        <span className="stats-aside">
          {fmt(rows.length)} {rows.length === 1 ? "row" : "rows"},{" "}
          {fmt(distinctCards(rows))}{" "}
          {distinctCards(rows) === 1 ? "card" : "cards"}
        </span>
      }
      aria-labelledby={id}
    >
      {rows.length ? (
        <Table
          columns={[
            { head: "Card", cell: (r) => <CardCell row={r} /> },
            { head: "Battles", num: true, cell: (r) => fmt(r.battles) },
            {
              head: "Record",
              cell: (r) => <Record wins={r.wins} losses={r.losses} />,
            },
            { head: "Won", num: true, cell: (r) => pct(r.rate) },
          ]}
          rows={shown}
          rowKey={(r) => r.key}
          className="stats-cards"
        />
      ) : (
        <div className="panel__body">
          <p className="text-ink-faint">
            No card reached the lowest it can show.
          </p>
        </div>
      )}
      {toggle}
      <div className="panel__foot">
        {whose.Your} record in the battles where {whose.your} deck held the
        card. A card in more than one deck carries all of their battles, so the
        rows overlap and never add up.
        {floor
          ? ` Cards in fewer than ${fmt(floor)} ${noun(floor, "battle")} are left out.`
          : ""}
      </div>
    </Panel>
  );
}

function TheirCards({ read, opponents, mode, order }) {
  const whose = useWhose();
  const id = useId();
  const rows = read.data ? cardRows(read.data) : [];
  const { shown, toggle } = useShown(rows);
  const battles = modeBattles(read.data, mode);
  const floor = read.data?.applied?.min_battles;
  return (
    <Panel
      title={`Across the table from ${whose.them}`}
      titleId={id}
      action={
        <span className="stats-aside">
          {[
            battles != null
              ? `${fmt(battles)} ${battles === 1 ? "battle" : "battles"}`
              : null,
            opponents != null
              ? `${fmt(opponents)} ${opponents === 1 ? "opponent" : "opponents"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      }
      aria-labelledby={id}
    >
      {read.isPending ? (
        <div className="panel__body">
          <Loading what={`the cards ${whose.you} faced`} />
        </div>
      ) : read.isError ? (
        <div className="panel__body">
          <ReadError query={read} what={`the cards ${whose.you} faced`} />
        </div>
      ) : rows.length ? (
        <Table
          columns={[
            {
              head: whose.own ? "Their card" : "Opponent's card",
              cell: (r) => <CardCell row={r} />,
            },
            { head: "Faced", num: true, cell: (r) => fmt(r.battles) },
            {
              head: `${whose.Your} record`,
              cell: (r) => <Record wins={r.wins} losses={r.losses} />,
            },
            { head: "Level gap", num: true, cell: (r) => gapText(r.gap) },
          ]}
          rows={shown}
          rowKey={(r) => r.key}
          className="stats-cards"
        />
      ) : (
        <div className="panel__body">
          <p className="text-ink-faint">
            No card reached the lowest it can show.
          </p>
        </div>
      )}
      {toggle}
      <div className="panel__foot">
        {whose.Your} record in the battles where the opponent&apos;s deck held
        the card
        {order === "losses" ? ", most battles lost first" : ""}. Level gap is
        {whose.your} deck&apos;s average card level minus {whose.your}{" "}
        opponent&apos;s in those battles (positive: {whose.yours} were higher);
        a dash where the record has no levels.
        {floor
          ? ` Cards met in fewer than ${fmt(floor)} ${noun(floor, "battle")} are left out.`
          : ""}
      </div>
    </Panel>
  );
}

/** How many players you met in this mode, and the ones you met again. */
function Opponents({ read, label, when, order }) {
  const whose = useWhose();
  const id = useId();
  const body = read.data;
  const repeats = body?.opponents ?? [];
  const more = Number(body?.matching_opponents ?? 0) - repeats.length;
  // A tag only tells two players of one name apart (2026-11-05, A31).
  const named = repeats.map(opponentName);
  const clashes = (o) => named.filter((n) => n === opponentName(o)).length > 1;
  return (
    <Panel title="Opponents" titleId={id} aria-labelledby={id}>
      <div className="panel__body">
        {read.isPending ? (
          <Loading what={`${whose.your} opponents`} />
        ) : read.isError ? (
          <ReadError query={read} what={`${whose.your} opponents`} />
        ) : (
          <>
            <p className="stats-opponents__lede">
              {fmt(body.distinct_opponents)} different{" "}
              {body.distinct_opponents === 1 ? "opponent" : "opponents"} on{" "}
              {label} {when}.{" "}
              {repeats.length
                ? `${cameBack(Number(body.matching_opponents ?? repeats.length))}${order === "losses" ? ", most battles lost first" : ""}:`
                : "None came back."}
            </p>
            {repeats.length ? (
              <ul className="stats-opponents">
                {repeats.map((o) => (
                  <li key={o.player_tag}>
                    <Link to={playerHref(o.player_tag)}>
                      <PlayerName tag={o.player_tag}>
                        {opponentName(o)}
                      </PlayerName>
                    </Link>
                    {clashes(o) ? (
                      <>
                        {" "}
                        <Tag
                          tag={o.player_tag}
                          className="stats-opponents__tag"
                        />
                      </>
                    ) : null}
                    , {times(o.battles)},{" "}
                    <Record wins={o.wins} losses={o.losses} draws={o.draws} />
                    {o.mean_level_gap != null ? (
                      <span className="stats-opponents__gap">
                        {" "}
                        · level gap {gapText(o.mean_level_gap)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {more > 0 ? (
              <p className="text-ink-faint">
                And {fmt(more)} more met again, past the first{" "}
                {fmt(repeats.length)}.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}
