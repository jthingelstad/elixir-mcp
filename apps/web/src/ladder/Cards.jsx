import { CardArt, Link, noun, Tag } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import { CONSOLE } from "../lib/console.js";
import {
  fmt,
  ladderHref,
  modeLabel,
  pct,
  seasonWords,
  signed,
} from "./ladder.js";
import {
  ORDERS,
  cameBack,
  cardRows,
  distinctCards,
  modeBattles,
  opponentName,
  pickOrder,
  times,
} from "./ladder-cards.js";
import { useToolRead } from "../lib/queries.js";
import { tagPath } from "../lib/tag-url.js";
import {
  LadderHead,
  Loading,
  ModeSwitch,
  ReadError,
  Record,
} from "./common.jsx";

/** Rows a card table shows before "Show all". */
const ROWS_SHOWN = 12;

/** The fewest meetings an opponent needs to be listed: met again. */
const OPPONENT_FLOOR = 2;

/**
 * Cards (LadderCards.dc.html): one mode's season, card by card. Your
 * cards and the cards across the table come from battles_cards (mine and
 * opponent), each a record of the battles where that deck held the card;
 * the opponents are battles_opponents' count and its repeats. A form is
 * its own row, as the tool keeps it; no row is summed with another.
 * What you faced reads in the tools' default order (most battles first)
 * unless the reader asks for most losses first (`?order=losses`, the
 * tools' `sort: "losses"`); each row carries its level gap where the
 * record has one.
 */
export function Cards({
  player,
  mode,
  modeReady,
  season,
  seasonPicker,
  search,
}) {
  const args = { player_tag: player.player_tag, season: season.arg, mode };
  const order = pickOrder(search.order);
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
  const hrefFor = (m) =>
    ladderHref("cards", {
      player: search.player,
      mode: m,
      season: search.season,
      order,
    });
  const orderHref = (o) =>
    ladderHref("cards", {
      player: search.player,
      mode: search.mode,
      season: search.season,
      order: o,
    });
  const when = seasonWords(season);
  const played = Number(modeBattles(mine.data, mode) ?? 0) > 0;

  return (
    <div className="ladder-page">
      <LadderHead
        player={player}
        page="Cards"
        title="Cards you played, cards you faced"
        lede={`${label}, ${when}. An evolution or a hero is a different card from its base form, so each keeps its own row. Every card name opens that card's public page: the same card across everyone Elixir records.`}
        observedAt={
          mine.data?.meta?.source_polls?.player_battlelog?.observed_at
        }
        season={season}
        seasonPicker={seasonPicker}
      />
      <ModeSwitch mode={mode} hrefFor={hrefFor} />
      {!modeReady || mine.isPending ? (
        <Loading what="your cards" />
      ) : mine.isError ? (
        <ReadError error={mine.error} what="your cards" />
      ) : !played ? (
        <div className="empty">
          <h2 className="empty__title">
            No {label} battles {when}
          </h2>
          <p className="empty__body">
            {season.current
              ? "Elixir has recorded none in this mode since the season began,"
              : `Elixir recorded none in this mode in ${season.name},`}{" "}
            so there are no cards to read back. Another mode&apos;s tab may hold
            your season.
          </p>
        </div>
      ) : (
        <>
          <YourCards body={mine.data} />
          <OrderSwitch
            order={order}
            hrefFor={orderHref}
            cardFloor={
              theirs.data?.applied?.min_battles ??
              mine.data?.applied?.min_battles
            }
          />
          <TheirCards
            read={theirs}
            opponents={opponents.data?.distinct_opponents ?? null}
            mode={mode}
            order={order}
          />
          <Opponents read={opponents} label={label} when={when} order={order} />
        </>
      )}
    </div>
  );
}

/** How what you faced is ordered: a choice the reader makes, each its own
 *  address like the mode tabs. The default is the tools' order (most
 *  battles first); most losses first is never chosen for the reader. It
 *  says the floors, so a single loss is seen not to lead the list. */
function OrderSwitch({ order, hrefFor, cardFloor }) {
  const id = useId();
  return (
    <div className="ladder-order">
      <span id={id} className="ladder-order__label">
        Order what you faced
      </span>
      <nav aria-labelledby={id} className="ladder-modes">
        {ORDERS.map((o) => (
          <Link
            key={o.key}
            to={hrefFor(o.key)}
            className="ladder-modes__tab"
            aria-current={o.key === order ? "true" : undefined}
          >
            {o.label}
          </Link>
        ))}
      </nav>
      <span className="ladder-order__hint">
        {order === "losses"
          ? "Most battles lost first, then most battles."
          : "Most battles first."}{" "}
        {cardFloor
          ? `A card is listed from ${fmt(cardFloor)} battles, `
          : "A card is listed from the tool's floor, "}
        a player from {fmt(OPPONENT_FLOOR)}.
      </span>
    </div>
  );
}

/** A level gap as the tools state it: "+0.40", "−1.25", or a dash where
 *  the record has no levels. */
const gapText = (gap) => (gap == null ? "—" : signed(Number(gap), 2));

/** A card's cell: its art, never a link, and its name, the one link. */
function CardCell({ row }) {
  return (
    <span className="ladder-card">
      <CardArt card={row.card} size={36} showLevel={false} />
      {row.href ? (
        <a className="ladder-card__name" href={row.href}>
          {row.label}
        </a>
      ) : (
        <span className="ladder-card__name">{row.label}</span>
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

function YourCards({ body }) {
  const id = useId();
  const rows = cardRows(body);
  const { shown, toggle } = useShown(rows);
  const floor = body?.applied?.min_battles;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          Your cards · {fmt(rows.length)} {rows.length === 1 ? "row" : "rows"},{" "}
          {fmt(distinctCards(rows))}{" "}
          {distinctCards(rows) === 1 ? "card" : "cards"}
        </h2>
      </div>
      {rows.length ? (
        <div className="table__scroll" tabIndex={0}>
          <table className="table ladder-cards">
            <thead>
              <tr>
                <th scope="col">Card</th>
                <th scope="col" className="ladder-table__num">
                  Battles
                </th>
                <th scope="col">Record</th>
                <th scope="col" className="ladder-table__num">
                  Won
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td>
                    <CardCell row={r} />
                  </td>
                  <td className="ladder-table__num">{fmt(r.battles)}</td>
                  <td>
                    <Record wins={r.wins} losses={r.losses} />
                  </td>
                  <td className="ladder-table__num">{pct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel__body">
          <p className="text-ink-faint">
            No card reached the tool&apos;s floor.
          </p>
        </div>
      )}
      {toggle}
      <div className="panel__foot">
        Your record in the battles where your deck held the card. A card in more
        than one deck carries all of their battles, so the rows overlap and
        never add up.
        {floor
          ? ` Cards in fewer than ${fmt(floor)} ${noun(floor, "battle")} are left out.`
          : ""}
      </div>
    </section>
  );
}

function TheirCards({ read, opponents, mode, order }) {
  const id = useId();
  const rows = read.data ? cardRows(read.data) : [];
  const { shown, toggle } = useShown(rows);
  const battles = modeBattles(read.data, mode);
  const floor = read.data?.applied?.min_battles;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          Across the table from you
        </h2>
        <span className="text-[12.5px] text-ink-faint">
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
      </div>
      {read.isPending ? (
        <div className="panel__body">
          <Loading what="the cards you faced" />
        </div>
      ) : read.isError ? (
        <div className="panel__body">
          <ReadError error={read.error} what="the cards you faced" />
        </div>
      ) : rows.length ? (
        <div className="table__scroll" tabIndex={0}>
          <table className="table ladder-cards">
            <thead>
              <tr>
                <th scope="col">Their card</th>
                <th scope="col" className="ladder-table__num">
                  Faced
                </th>
                <th scope="col">Your record</th>
                <th scope="col" className="ladder-table__num">
                  Level gap
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td>
                    <CardCell row={r} />
                  </td>
                  <td className="ladder-table__num">{fmt(r.battles)}</td>
                  <td>
                    <Record wins={r.wins} losses={r.losses} />
                  </td>
                  <td className="ladder-table__num">{gapText(r.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel__body">
          <p className="text-ink-faint">
            No card reached the tool&apos;s floor.
          </p>
        </div>
      )}
      {toggle}
      <div className="panel__foot">
        Your record in the battles where the opponent&apos;s deck held the card
        {order === "losses" ? ", most battles lost first" : ""}. Level gap is
        your deck&apos;s average card level minus your opponent&apos;s in those
        battles (positive: yours were higher); a dash where the record has no
        levels.
        {floor
          ? ` Cards met in fewer than ${fmt(floor)} ${noun(floor, "battle")} are left out.`
          : ""}
      </div>
    </section>
  );
}

/** How many players you met in this mode, and the ones you met again. */
function Opponents({ read, label, when, order }) {
  const id = useId();
  const body = read.data;
  const repeats = body?.opponents ?? [];
  const more = Number(body?.matching_opponents ?? 0) - repeats.length;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          Opponents
        </h2>
      </div>
      <div className="panel__body">
        {read.isPending ? (
          <Loading what="your opponents" />
        ) : read.isError ? (
          <ReadError error={read.error} what="your opponents" />
        ) : (
          <>
            <p className="ladder-opponents__lede">
              {fmt(body.distinct_opponents)} different{" "}
              {body.distinct_opponents === 1 ? "opponent" : "opponents"} on{" "}
              {label} {when}.{" "}
              {repeats.length
                ? `${cameBack(Number(body.matching_opponents ?? repeats.length))}${order === "losses" ? ", most battles lost first" : ""}:`
                : "None came back."}
            </p>
            {repeats.length ? (
              <ul className="ladder-opponents">
                {repeats.map((o) => (
                  <li key={o.player_tag}>
                    <Link
                      to={`${CONSOLE}/explore/player/${tagPath(o.player_tag)}`}
                    >
                      {opponentName(o)}
                    </Link>{" "}
                    <Tag tag={o.player_tag} className="ladder-opponents__tag" />
                    , {times(o.battles)},{" "}
                    <Record wins={o.wins} losses={o.losses} draws={o.draws} />
                    {o.mean_level_gap != null ? (
                      <span className="ladder-opponents__gap">
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
    </section>
  );
}
