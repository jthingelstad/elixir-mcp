import { Icon } from "./Icon.jsx";

/**
 * A deck the way the game lays it out: two rows of four. `cards` is the
 * eight-slot list ({ id, name, icon, matched }) or null for "nothing
 * seen yet", which draws eight empty slots. Matched slots light up one
 * at a time, so progress is visible before the whole deck is.
 */
export function DeckGrid({ cards, label, dimUnmatched = false }) {
  const slots = Array.from({ length: 8 }, (_, i) => cards?.[i] ?? null);
  return (
    <ul className="deck" aria-label={label}>
      {slots.map((c, i) => (
        <li
          key={c ? `${c.id}-${i}` : `empty-${i}`}
          className={[
            "deck__slot",
            c ? "" : "deck__slot--empty",
            c?.matched ? "deck__slot--matched" : "",
            c && dimUnmatched && !c.matched ? "deck__slot--dim" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-matched={c?.matched ? "true" : "false"}
        >
          {c ? (
            <>
              {c.icon ? (
                <img src={c.icon} alt="" loading="lazy" />
              ) : (
                <span className="deck__fallback">{c.name ?? c.id}</span>
              )}
              <span className="deck__name">{c.name ?? c.id}</span>
              {c.matched && (
                <span className="deck__check" aria-label="in place">
                  <Icon name="circle-check" size={16} />
                </span>
              )}
            </>
          ) : (
            <span className="deck__fallback" aria-hidden="true">
              ·
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
