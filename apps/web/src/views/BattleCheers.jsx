import { TagText, useClock } from "@elixir-mcp/ui";
import { Cheers, usePageCheered } from "../home/Cheers.jsx";

/**
 * Cheers on a battle's page (2026-11-12): the items in your own feed that
 * this battle proves or that highlight it (a posted highlight, a moment it
 * proved), each with its cheers. Signed-in members only: the page draws
 * this only for them, and a reader with no such item sees nothing at all,
 * no panel and no counts. Anyone signed out sees neither the cheers nor how
 * many there are.
 */
export function BattleCheers({ battle }) {
  const cheered = usePageCheered({ battle: battle.id });
  const { when } = useClock();
  const items = cheered.items;
  if (items.length === 0) return null;
  return (
    <section className="panel" aria-label="Cheers">
      <div className="panel__head">In your feed</div>
      <div className="panel__body kit-battle-cheers">
        {items.map((c) => {
          const it = cheered.of(c);
          return (
            <article key={c.id} className="kit-battle-cheers__item">
              <p className="kit-feed__text">
                <TagText>{c.text}</TagText>
                {c.at ? (
                  <span className="kit-tiny"> · {when(c.at)}</span>
                ) : null}
              </p>
              {it ? <Cheers it={it} where={cheered.where} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
