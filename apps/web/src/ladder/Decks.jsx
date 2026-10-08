import { CardArt, DeckGrid, useClock, noun } from "@elixir-mcp/ui";
import { useId, useState } from "react";
import { fmt, longDay, pct, shortDay, signed } from "./ladder.js";
import { groupLabel } from "./ladder-days.js";
import {
  GRID_MODES,
  dayRange,
  deckCount,
  decksTitle,
  formNames,
  formSwaps,
  gapLine,
  modesOf,
  nameList,
  tableRows,
  tableTitle,
} from "./ladder-decks.js";
import { useToolRead, useToolReads } from "../lib/queries.js";
import { LadderHead, Loading, ReadError, Record } from "./common.jsx";

/** Decks a trophy mode shows with their cards before "Show all"; each
 *  shown deck is one read for its cards. */
const DECKS_SHOWN = 6;
/** One page of battles_decks: every deck a season holds, in practice. */
const LIMIT = 100;

/**
 * Decks (LadderDecks.dc.html): every deck of the season, judged in the
 * mode it was played in. battles_decks reads once over every mode (which
 * modes, and the duel rounds), then once per mode; the trophy modes show
 * each deck's cards (one read per deck, by its deck_hash), and every
 * other mode is a row of one table. No record here pools two modes.
 */
export function Decks({ player }) {
  const { zone } = useClock();
  const base = { player_tag: player.player_tag, season: "current" };
  const all = useToolRead("battles_decks", { ...base, limit: LIMIT });
  const modes = all.data ? modesOf(all.data) : [];
  const reads = useToolReads(
    "battles_decks",
    modes.map((mode) => ({ ...base, mode, limit: LIMIT })),
  );
  const byMode = Object.fromEntries(modes.map((m, i) => [m, reads[i]]));
  const count = all.data ? deckCount(all.data) : 0;

  return (
    <div className="ladder-page">
      <LadderHead
        player={player}
        page="Decks"
        title={all.data && count ? decksTitle(count, modes.length) : "Decks"}
        lede="A deck is judged in the mode it was played in. War draws opponents from the racing clans, not from your trophies, so a war record and a Trophy Road record never sit in one column."
        observedAt={all.data?.meta?.source_polls?.player_battlelog?.observed_at}
      />
      {all.isPending ? (
        <Loading what="the season's decks" />
      ) : all.isError ? (
        <ReadError error={all.error} what="the season's decks" />
      ) : count === 0 ? (
        <div className="empty">
          <h2 className="empty__title">No decks this season yet</h2>
          <p className="empty__body">
            Elixir has recorded no battle with a deck since the season began.
            The page fills from the next battle log it reads.
          </p>
        </div>
      ) : (
        <>
          {modes
            .filter((m) => GRID_MODES.includes(m))
            .map((mode) => (
              <ModeDecks
                key={mode}
                mode={mode}
                read={byMode[mode]}
                base={base}
                zone={zone}
              />
            ))}
          <OtherDecks
            modes={modes.filter((m) => !GRID_MODES.includes(m))}
            byMode={byMode}
            all={all.data}
          />
        </>
      )}
    </div>
  );
}

/** One trophy mode's decks, each with its cards, and any swap of forms
 *  between two of them. The heading's battles and record are the mode's
 *  season as battles_performance reads it (the season home's read). */
function ModeDecks({ mode, read, base, zone }) {
  const id = useId();
  const [every, setEvery] = useState(false);
  const perf = useToolRead("battles_performance", { ...base, mode });
  const decks = read?.data?.decks ?? [];
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
  const w = perf.data?.window;
  const label = groupLabel(mode);

  return (
    <>
      <section className="panel" aria-labelledby={id}>
        <div className="panel__head">
          <h2 id={id} className="ladder-panel-title">
            {label}
            {w && Number(w.battles ?? 0) > 0 ? (
              <>
                {" "}
                · {fmt(w.battles)} {w.battles === 1 ? "battle" : "battles"},{" "}
                <Record wins={w.wins} losses={w.losses} draws={w.draws} />
              </>
            ) : null}
          </h2>
          <span className="text-[12.5px] text-ink-faint">
            {fmt(decks.length)} {decks.length === 1 ? "deck" : "decks"}, played
            most first
          </span>
        </div>
        {read?.isPending ? (
          <div className="panel__body">
            <Loading what={`the ${label} decks`} />
          </div>
        ) : read?.isError ? (
          <div className="panel__body">
            <ReadError error={read.error} what={`the ${label} decks`} />
          </div>
        ) : (
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
        )}
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
        {read?.data?.next_offset != null ? (
          <div className="panel__foot">
            {decks.length === 1
              ? "This is the deck"
              : `These are the ${fmt(decks.length)} decks`}{" "}
            played most of {fmt(read.data.total_decks)}.
          </div>
        ) : null}
      </section>
      {swaps.map((s) => (
        <SwapPanel key={s.key} swap={s} mode={mode} zone={zone} />
      ))}
    </>
  );
}

/** One deck: its name and forms, when it was played, its eight cards,
 *  and its record in this mode with the level gap beside it. Until its
 *  cards are read (or if that read fails) the names stand in. */
function DeckRow({ row, full, pending, zone }) {
  const name = row.archetype_label ?? "Unnamed deck";
  const forms = formNames(full ?? row);
  const avg = full?.archetype?.average_elixir;
  const gap = gapLine(row.mean_level_gap);
  return (
    <li className="ladder-deckrow">
      <div className="ladder-deckrow__id">
        <p className="ladder-deckrow__name">{name}</p>
        {forms ? <p className="ladder-deckrow__forms">{forms}</p> : null}
        <p className="ladder-deckrow__when">
          {[
            dayRange(row.first_used, row.last_used, zone),
            avg != null ? `${Number(avg).toFixed(2)} average elixir` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
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
          <p className="ladder-deckrow__names">{row.card_names}</p>
        )}
      </div>
      <div className="ladder-deckrow__facts">
        <span className="ladder-deckrow__n">
          {fmt(row.battles)} {row.battles === 1 ? "battle" : "battles"}
        </span>
        <span className="ladder-deckrow__record">
          <Record wins={row.wins} losses={row.losses} draws={row.draws} />
          <span className="ladder-fact__aside">{pct(row.win_rate)}</span>
        </span>
        {gap ? <span className="ladder-deckrow__gap">{gap}</span> : null}
      </div>
    </li>
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
  const on = longDay(swap.at, zone).replace(/^[A-Za-z]+, /, "");
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
          {deck.mean_level_gap != null
            ? ` · gap ${signed(deck.mean_level_gap, 2)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
  return (
    <section className="panel ladder-swap" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          The {kind === "form" ? "form" : kind} swap on {on}
        </h2>
        <span className="text-[12.5px] text-ink-faint">
          {groupLabel(mode)} only
        </span>
      </div>
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
        Each record is that deck&apos;s own in {groupLabel(mode)}. The record
        reads back what happened after the change; it does not say the change
        caused it.
      </div>
    </section>
  );
}

/** Every deck of the modes shown without cards: war, its duel rounds,
 *  events and the rest, one row per deck per mode. */
function OtherDecks({ modes, byMode, all }) {
  const id = useId();
  if (!modes.length) return null;
  const pending = modes.some((m) => byMode[m]?.isPending);
  const failed = modes.filter((m) => byMode[m]?.isError);
  const bodies = Object.fromEntries(
    modes.filter((m) => byMode[m]?.data).map((m) => [m, byMode[m].data]),
  );
  const rows = pending ? [] : tableRows(bodies, all);
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="ladder-panel-title">
          {pending ? "Other modes" : tableTitle(rows)}
        </h2>
      </div>
      {pending ? (
        <div className="panel__body">
          <Loading what="the other modes' decks" />
        </div>
      ) : (
        <>
          {failed.map((m) => (
            <div key={m} className="panel__body">
              <ReadError
                error={byMode[m].error}
                what={`the ${groupLabel(m)} decks`}
              />
            </div>
          ))}
          {rows.length ? (
            <div className="table__scroll" tabIndex={0}>
              <table className="table ladder-table">
                <thead>
                  <tr>
                    <th scope="col">Deck</th>
                    <th scope="col">Mode</th>
                    <th scope="col" className="ladder-table__num">
                      Battles
                    </th>
                    <th scope="col">Record</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="ladder-table__deck">{r.label}</td>
                      <td className="ladder-table__mode">
                        <span className="ladder-key">
                          {r.mode ? (
                            <span
                              className={`mode-chip__dot mode-chip__dot--${r.mode}`}
                              aria-hidden="true"
                            />
                          ) : null}
                          {r.modeLabel}
                        </span>
                      </td>
                      <td className="ladder-table__num">
                        {fmt(r.battles)}
                        {/* A phone has no column head: the count names
                            its unit there. */}
                        <span className="ladder-table__unit">
                          {" "}
                          {r.duel
                            ? r.battles === 1
                              ? "round"
                              : "rounds"
                            : r.battles === 1
                              ? "battle"
                              : "battles"}
                        </span>
                      </td>
                      <td className="ladder-table__record">
                        <Record
                          wins={r.wins}
                          losses={r.losses}
                          draws={r.draws}
                        />
                      </td>
                      <td className="ladder-table__notes">
                        {[
                          r.forms,
                          r.gap,
                          r.duel ? "duel rounds" : null,
                          r.sameAs
                            ? `same cards as a ${groupLabel(r.sameAs)} deck`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
      <div className="panel__foot">
        Each row is one deck in one mode. A duel row counts its rounds, each won
        or lost on its own crowns; a duel has no single deck, so it is outside
        the other rows.
      </div>
    </section>
  );
}
