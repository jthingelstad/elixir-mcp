import { useMemo, useState } from "react";

/**
 * The operator picks a Clash Royale card as their collector's public
 * face (Jamie, 2026-09-11: running one is a favour, and people have
 * favourite cards). A card is one live collector's: a taken one stays
 * in the grid so you can see it went, dimmed and not offered. The
 * catalog comes from /api/gateways/cards, which says who holds what.
 */
export function CardPicker({ cards, value, onChange, current = null }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? cards.filter((c) => c.name.toLowerCase().includes(needle))
      : cards;
  }, [cards, q]);
  const picked = cards.find((c) => c.name === value);
  return (
    <div className="cardpick">
      <input
        className="input"
        placeholder="find a card"
        aria-label="find a card"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: "9px 12px" }}
      />
      <div className="cardpick__grid" role="listbox" aria-label="cards">
        {shown.map((c) => {
          // Your own current card is not "taken" from you.
          const taken = c.taken && c.name !== current;
          const isPicked = c.name === value;
          return (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={isPicked}
              aria-disabled={taken}
              title={taken ? `${c.name} — taken` : c.name}
              className={
                "cardpick__card" +
                (isPicked ? " cardpick__card--picked" : "") +
                (taken ? " cardpick__card--taken" : "")
              }
              onClick={() => !taken && onChange(c.name)}
            >
              {c.icon ? (
                <img src={c.icon} alt={c.name} loading="lazy" />
              ) : (
                <span style={{ fontSize: "11px" }}>{c.name}</span>
              )}
            </button>
          );
        })}
        {shown.length === 0 && (
          <span style={{ gridColumn: "1 / -1", color: "var(--ink-faint)" }}>
            No card by that name.
          </span>
        )}
      </div>
      <div className="cardpick__caption">
        {picked ? (
          <>
            {picked.icon && (
              <img
                src={picked.icon}
                alt=""
                style={{ height: "22px", borderRadius: "3px" }}
              />
            )}
            <span>
              Your collector will be <strong>{picked.name}</strong>
              {picked.rarity ? ` · ${picked.rarity}` : ""}
              {picked.elixir_cost != null
                ? ` · ${picked.elixir_cost} elixir`
                : ""}
            </span>
          </>
        ) : (
          <span>
            Pick a card — it becomes the collector&rsquo;s public name.
          </span>
        )}
      </div>
    </div>
  );
}
