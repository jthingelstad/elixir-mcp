import { Icon, Link, StampMini } from "@elixir-mcp/ui";
import { stampById } from "@elixir-mcp/stamps/catalog";
import { PASSPORT, passportHref } from "../lib/passport.js";

/** A compact passport row (Profile, a verified player's page): up to two
 *  marks, the count and Open passport. `summary` is { id, count, marks }. */
export function PassportRow({ summary, own = false }) {
  const marks = (summary?.marks ?? [])
    .map((m) => stampById(m.stamp_id))
    .filter(Boolean)
    .slice(0, 2);
  const count = summary?.count ?? 0;
  return (
    <div className="kit-passport-row">
      {marks.length ? (
        <span className="kit-passport-row__marks">
          {marks.map((s) => (
            <StampMini key={s.id} stamp={s} />
          ))}
        </span>
      ) : null}
      <span>
        {count === 0 ? "No Stamps yet" : count === 1 ? "1 Stamp" : `${count} Stamps`}
      </span>
      <Link
        className="kit-passport-row__open"
        to={own ? PASSPORT : passportHref(summary?.id)}
      >
        Open passport
        <Icon name="arrow-right" size={14} />
      </Link>
    </div>
  );
}
