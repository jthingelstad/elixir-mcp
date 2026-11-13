import { CardArt, DeckGrid, Empty, Panel, useClock } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import { OTHER, fmt, modeLabel, pct, readModes, shortDay } from "./ladder.js";
import {
  deckLine,
  dayRange,
  formNames,
  formSwaps,
  nameList,
} from "./ladder-decks.js";
import { useToolReads } from "../lib/queries.js";
import { Loading, ReadError, Record } from "./common.jsx";
import { useWhose } from "./whose.js";

/** Decks a panel shows with their cards before "Show all"; each shown deck is
 *  one read for its cards. */
const DECKS_SHOWN = 6;
/** One page of battles_decks: every deck a season holds, in practice. */
const LIMIT = 100;

/**
 * The Decks tab: every deck of the season in this chip's mode, its record there,
 * its real cards in every mode. A war deck has a row here like any other, and its
 * duel rounds have their own panel, because a duel has no single deck. Other is
 * Challenge and Tournament read apart, a section each.
 */
export function Decks({ player, mode, modeReady, season }) {
  const whose = useWhose();
  const groups = readModes(mode);
  const base = { player_tag: player.player_tag, season: season.arg };
  const reads = useToolReads(
    "battles_decks",
    groups.map((m) => ({ ...base, mode: m, limit: LIMIT })),
    { enabled: modeReady },
  );
  if (!modeReady || reads.some((r) => r.isPending))
    return <Loading what={`${whose.your} decks`} />;
  const failed = reads.find((r) => r.isError);
  if (failed)
    return <ReadError error={failed.error} what={`${whose.your} decks`} />;
  const count = (r) =>
    (r.data?.decks?.length ?? 0) + (r.data?.duel_decks?.length ?? 0);
  if (!reads.some((r) => count(r) > 0))
    return (
      <Empty
        titleAs="h2"
        title={
          season.current
            ? "No decks this season yet"
            : `No decks in ${season.name}`
        }
      >
        {season.current
          ? "Elixir has recorded no battle with a deck in this mode since the season began. The page fills from the next battle log it reads."
          : `Elixir recorded no battle with a deck in ${season.name}.`}
      </Empty>
    );
  return groups.map((m, i) =>
    count(reads[i]) > 0 ? (
      <ModeDecks
        key={m}
        mode={m}
        read={reads[i]}
        base={base}
        other={mode === OTHER.key}
      />
    ) : null,
  );
}

function ModeDecks({ mode, read, base }) {
  const { zone } = useClock();
  const id = useId();
  const [every, setEvery] = useState(false);
  const decks = read.data?.decks ?? [];
  const duels = read.data?.duel_decks ?? [];
  const shown = every ? decks : decks.slice(0, DECKS_SHOWN);
  const details = useToolReads(
    "battles_decks",
    shown.map((d) => ({ ...base, mode, deck_hash: d.deck_hash })),
  );
  const full = shown.map(
    (d, i) =>
      details[i]?.data?.decks?.find((r) => r.deck_hash === d.deck_hash) ?? null,
  );
  const swaps = formSwaps(full.filter(Boolean));
  const label = modeLabel(mode);
  return (
    <>
      {decks.length ? (
        <Panel
          title={`${fmt(decks.length)} ${decks.length === 1 ? "deck" : "decks"} in ${label}`}
          titleId={id}
          action={<span className="ladder-aside">Most played first</span>}
          aria-labelledby={id}
        >
          <ul className="ladder-decks">
            {shown.map((d, i) => (
              <DeckRow
                key={d.deck_hash}
                row={d}
                full={full[i]}
                pending={Boolean(details[i]?.isPending)}
                zone={zone}
              />
            ))}
          </ul>
          {decks.length > DECKS_SHOWN ? (
            <div className="panel__foot">
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                aria-expanded={every}
                onClick={() => setEvery((v) => !v)}
              >
                {every
                  ? `Show the ${DECKS_SHOWN} played most`
                  : `Show all ${fmt(decks.length)} decks`}
              </button>
            </div>
          ) : null}
          {read.data?.next_offset != null ? (
            <div className="panel__foot">
              These are the {fmt(decks.length)} played most of{" "}
              {fmt(read.data.total_decks)}.
            </div>
          ) : null}
          <div className="panel__foot">
            A deck is its exact cards, forms and tower troop, so the same eight
            names can be two rows.
          </div>
        </Panel>
      ) : null}
      {swaps.map((s) => (
        <SwapPanel key={s.key} swap={s} mode={mode} zone={zone} />
      ))}
      {duels.length ? <DuelRounds duels={duels} /> : null}
    </>
  );
}

/** One deck: its name, its record, its eight cards, and a line of facts. Until
 *  its cards are read (or if that read fails) the names stand in. */
function DeckRow({ row, full, pending, zone }) {
  const whose = useWhose();
  const name = row.archetype_label ?? "Unnamed deck";
  const forms = formNames(full ?? row);
  return (
    <li className="ladder-deckrow">
      <p className="ladder-deckrow__name">{name}</p>
      <p className="ladder-deckrow__rec">
        {fmt(row.battles)} {row.battles === 1 ? "battle" : "battles"} ·{" "}
        <Record wins={row.wins} losses={row.losses} draws={row.draws ?? 0} />
        {row.win_rate != null ? ` · ${pct(row.win_rate)} won` : ""}
      </p>
      <div className="ladder-deckrow__cards">
        {full?.cards?.length ? (
          <DeckGrid
            cards={full.cards}
            size={44}
            columns={8}
            showLevel={false}
            label={`Cards in ${name}`}
          />
        ) : pending ? (
          <Loading what="the cards" />
        ) : (
          <p className="ladder-deckrow__line">{row.card_names}</p>
        )}
      </div>
      {forms ? <p className="ladder-deckrow__line">{forms}</p> : null}
      <p className="ladder-deckrow__line">
        {deckLine(row, full, zone, whose.own)}
      </p>
    </li>
  );
}

/** A duel spends one deck a round, so its row counts rounds. */
function DuelRounds({ duels }) {
  return (
    <Panel title="Duel rounds">
      <ul className="ladder-rows">
        {duels.map((d) => (
          <li key={`${d.deck_hash}|${d.mode}`} className="ladder-duel">
            <span className="ladder-duel__name">
              {d.archetype_label ?? d.card_names ?? "Unnamed deck"}
            </span>
            <span className="ladder-duel__rec">
              {fmt(d.rounds)} {d.rounds === 1 ? "round" : "rounds"} ·{" "}
              <Record wins={d.wins} losses={d.losses} />
            </span>
          </li>
        ))}
      </ul>
      <div className="panel__foot">
        Each row is one deck in one mode. A duel row counts its rounds, each won
        or lost on its own crowns; a duel has no single deck, so it is outside
        the other rows.
      </div>
    </Panel>
  );
}

const KIND = {
  evolution: ["Evolution", "Evolutions"],
  hero: ["Hero form", "Hero forms"],
  form: ["Form", "Forms"],
};
const kindWord = (kind, n) => KIND[kind][n === 1 ? 0 : 1];

/** Two decks of the same eight cards, one put down before the other was
 *  picked up, with a form moved between them: what changed, what did
 *  not, and each deck's own record in this mode. The page says when, and
 *  what the record was; it never says the change caused it. */
function SwapPanel({ swap, mode, zone }) {
  const id = useId();
  const { before, after, unchanged, kind } = swap;
  const { whenDay } = useClock();
  const side = (deck, when, cards, caption) => (
    <div className="ladder-swap__side">
      <p className="ladder-swap__when">{when}</p>
      {cards.length ? (
        <ul className="ladder-swap__cards">
          {cards.map((c) => (
            <li key={c.id}>
              <CardArt card={c} size={44} showLevel={false} />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ladder-swap__what">{caption}</p>
      {deck ? (
        <p className="ladder-swap__record">
          <Record
            wins={deck.wins}
            losses={deck.losses}
            draws={deck.draws ?? 0}
          />{" "}
          {pct(deck.win_rate)} won · {fmt(deck.battles)}{" "}
          {deck.battles === 1 ? "battle" : "battles"}
        </p>
      ) : null}
    </div>
  );
  return (
    <Panel
      title={`The ${kind === "form" ? "form" : kind} swap on ${whenDay(swap.at)}`}
      titleId={id}
      action={<span className="ladder-aside">{modeLabel(mode)} only</span>}
      className="ladder-swap"
      aria-labelledby={id}
    >
      <div className="panel__body ladder-swap__body">
        {side(
          before.row,
          `Before, ${dayRange(before.row.first_used, before.row.last_used, zone)}`,
          before.cards,
          before.cards.length
            ? `${kindWord(kind, before.cards.length)} on ${nameList(before.cards)}`
            : `No ${kindWord(kind, 2).toLowerCase()} on these cards`,
        )}
        {side(
          after.row,
          `After, ${shortDay(after.row.first_used, zone)} on`,
          after.cards,
          after.cards.length
            ? `${kindWord(kind, after.cards.length)} moved to ${nameList(after.cards)}`
            : `${kindWord(kind, 2)} taken off`,
        )}
        {side(
          null,
          "Unchanged in both",
          unchanged,
          `${fmt(unchanged.length)} ${unchanged.length === 1 ? "card" : "cards"} in the same form in both decks`,
        )}
      </div>
      <div className="panel__foot">
        Each record is that deck&apos;s own in {modeLabel(mode)}. The record
        reads back what happened after the change; it does not say the change
        caused it.
      </div>
    </Panel>
  );
}
