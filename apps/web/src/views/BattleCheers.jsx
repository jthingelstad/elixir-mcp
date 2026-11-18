import { TagText, useClock } from "@elixir-mcp/ui";
import { Cheers, usePageCheered } from "../home/Cheers.jsx";
import { Comments } from "../home/Comments.jsx";

/**
 * The recorded Timeline items this battle proves, with their member-only
 * interactions. A battle without a visible item has no thread of its own.
 */
export function BattleCheers({ battle }) {
  const cheered = usePageCheered({ battle: battle.id });
  const { when } = useClock();
  const items = cheered.items;
  if (items.length === 0) return null;
  return (
    <section className="panel" aria-label="Cheers">
      <div className="panel__head">Timeline items</div>
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
              {it ? <Comments it={it} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
