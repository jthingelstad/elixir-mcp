import { Icon, noun, Link } from "@elixir-mcp/ui";
import { n, date } from "../lib/words.js";

const STATUS = {
  holding: ["Holding Elder", "chip--ok"],
  slipping: ["Slipping: demotion building", "chip--warn"],
  rising: ["Rising: promotion building", "chip--info"],
  participating: ["Participating", "chip--mute"],
  quiet: ["Quiet", "chip--mute"],
};

/** What the status chip reads, tied to the fact behind it (A10). */
export const statusChip = (status) => STATUS[status] ?? null;

const MINIMUM = {
  war: ["war deck", "war decks"],
  ranked: ["Path of Legends battle", "Path of Legends battles"],
  donations: ["donation a week", "donations a week"],
  trophies: ["trophy", "trophies"],
};

const MET = {
  true: ["Met", "text-ok", "circle-check"],
  false: ["Not met", "text-warn", "x"],
  null: ["Not known yet", "text-ink-faint", "circle-dashed"],
};

const minimumWords = (key, need) =>
  `${n(need)} ${MINIMUM[key]?.[need === 1 ? 0 : 1] ?? key}`;

/**
 * The answer to "am I OK?", in the engine's own words for it: `passes` and
 * `unknown` are the policy's judgment (facts.mjs), never this page's sums.
 * Jamie, 2026-11-06, the critique's fourth: "Approved to fix all 10 items."
 */
function verdictOf(minimums) {
  if (minimums.passes)
    return ["You are meeting the minimum", "text-ok", "circle-check"];
  if (minimums.unknown)
    return [
      "Elixir cannot say yet whether you are meeting the minimum",
      "text-ink-faint",
      "circle-dashed",
    ];
  return ["You are not meeting the minimum yet", "text-warn", "x"];
}

export function Minimums({ minimums, ranks }) {
  const [said, tone, icon] = verdictOf(minimums);
  const weeks = `${minimums.window_weeks} ${noun(minimums.window_weeks, "week")}`;
  const near = minimums.nearest;
  return (
    <div className="grid gap-1.5">
      {ranks ? null : (
        <p className="clan-verdict">
          <span className={tone}>
            <Icon name={icon} size={18} />
          </span>
          <span>{said}</span>
        </p>
      )}
      <p className="m-0 text-[13.5px] text-ink-dim">
        {minimums.rule === "all"
          ? `All of these, over ${weeks}.`
          : `Any one of these is enough, over ${weeks}.`}
        {!ranks && !minimums.passes && !minimums.unknown && near
          ? ` Your nearest is ${minimumWords(near.key, near.need)}: you are at ${n(Math.floor(near.have))}.`
          : ""}
      </p>
      <ul className="m-0 p-0 list-none grid gap-1">
        {Object.entries(minimums.set).map(([k, need]) => {
          const [met, metTone, metIcon] = MET[minimums.met[k] ?? "null"];
          return (
            <li key={k} className="flex items-center gap-2">
              <span className="grow">{minimumWords(k, need)}</span>
              <span className={`inline-flex items-center gap-1 ${metTone}`}>
                <Icon name={metIcon} size={15} />
                {met}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A hold, in one sentence, with what it does and does not do. */
export function holdWords(hold) {
  const until = hold.until ? ` until ${date(hold.until)}` : "";
  return hold.kind === "away"
    ? `You are marked away${until}. Your leaders can see this. Keeps you off the removal list while it's on. The days keep counting.`
    : `A leader has you on hold${until}. Keeps you off the removal list while it's on. The days keep counting.`;
}

/** Your own clock, the only clock below co-leader (Q1). */
function Clock({ inactivity, awayTo, navigate }) {
  if (!inactivity || inactivity.state === "none") return null;
  const held = inactivity.judgment === "held";
  return (
    <div className="callout callout--warn clan-clock">
      <span>
        {held
          ? "Your activity could not be read just now."
          : `${Math.floor(inactivity.days_idle)} ${noun(Math.floor(inactivity.days_idle), "day")} since your last battle; this clan counts a member at risk from ${inactivity.at_risk_days}. Modes the battle log does not carry are not seen.`}
      </span>
      {!held && awayTo ? (
        <Link to={awayTo} navigate={navigate} className="btn btn--sm">
          Mark me away
        </Link>
      ) : null}
    </div>
  );
}

/**
 * How someone is doing in this clan, in their own numbers: the answer on the
 * minimums first, then the clock, a hold, the evidence and tenure. What the
 * clan counts is in How it works here. Facts and no advice (Q14). Today and their own member page both show it; a
 * clan with no policy says so and shows no chip.
 */
export function HowYouAreDoing({ d, base, navigate }) {
  const c = d.clan;
  const y = d.you;
  const away = `${base}/members/away`;
  if (!c)
    return (
      <p className="m-0 text-ink-dim">
        {d.policy?.set
          ? `Clan management starts at ${d.min_members} members; this clan has ${d.members}. Your numbers are below.`
          : "This clan's leaders have not set up how the clan runs here yet. Your numbers are below."}
      </p>
    );
  const ranks = ["leader", "coLeader"].includes(y?.role);
  return (
    <div className="grid gap-2.5">
      {ranks ? (
        <p className="m-0 text-ink-dim">
          Leaders and co-leaders have no group. These are your own numbers.
        </p>
      ) : null}
      {Object.keys(c.minimums?.set ?? {}).length ? (
        <Minimums minimums={c.minimums} ranks={ranks} />
      ) : null}
      <Clock inactivity={c.inactivity} awayTo={away} navigate={navigate} />
      {d.hold ? <div className="notice">{holdWords(d.hold)}</div> : null}
      {!ranks && c.evidence ? <p className="m-0">{c.evidence}</p> : null}
      {c.tenure_min_days != null && y?.time_here?.tenure_known ? (
        <p className="m-0 text-[13.5px] text-ink-dim">
          {y.time_here.days >= c.tenure_min_days
            ? `${y.time_here.days} ${noun(y.time_here.days, "day")} in the clan: past the ${c.tenure_min_days} ${noun(c.tenure_min_days, "day")} Elder asks for.`
            : `${y.time_here.days} of the ${c.tenure_min_days} ${noun(c.tenure_min_days, "day")} in the clan Elder asks for.`}
        </p>
      ) : null}
    </div>
  );
}

/** One head for a card: its title, with what sits at its right. */
export function CardHead({ id, title, children }) {
  return (
    <div className="panel__head flex-wrap gap-2">
      <h3 id={id} className="kit-panel__title grow">
        {title}
      </h3>
      {children}
    </div>
  );
}
