import { Icon, noun } from "@elixir-mcp/ui";
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
const COUNTS = {
  war: "War decks count here: four a war day, up to the clan's finish.",
  ranked: "Path of Legends battles count here.",
  donations: "Donations count here.",
  trophies: "Trophies count here.",
};

const MET = {
  true: [": met", "text-ok", "circle-check"],
  false: [": not met", "text-warn", "x"],
  null: [": not known yet", "text-ink-faint", "circle-dashed"],
};

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
        <a
          className="btn btn--sm"
          href={awayTo}
          onClick={(e) => {
            e.preventDefault();
            navigate?.(awayTo);
          }}
        >
          Mark me away
        </a>
      ) : null}
    </div>
  );
}

/**
 * How someone is doing in this clan, in their own numbers: the group, the
 * evidence, what the clan counts, the minimums, tenure, the clock and a hold.
 * Facts and no advice (Q14). Today and their own member page both show it; a
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
      ) : c.evidence ? (
        <p className="m-0">{c.evidence}</p>
      ) : null}
      <Clock inactivity={c.inactivity} awayTo={away} navigate={navigate} />
      {d.hold ? <div className="notice">{holdWords(d.hold)}</div> : null}
      {Object.keys(c.minimums?.set ?? {}).length ? (
        <div className="grid gap-1.5">
          <h3 className="label m-0">
            Minimums, {c.minimums.rule === "all" ? "all of" : "any one of"},
            over {c.minimums.window_weeks}{" "}
            {noun(c.minimums.window_weeks, "week")}
          </h3>
          <ul className="m-0 p-0 list-none grid gap-1">
            {Object.entries(c.minimums.set).map(([k, need]) => {
              const met = c.minimums.met[k];
              const [said, tone, icon] = MET[met ?? "null"];
              return (
                <li key={k} className="flex items-center gap-2">
                  <span className={tone}>
                    <Icon name={icon} size={15} />
                  </span>
                  <span>
                    {n(need)} {MINIMUM[k]?.[need === 1 ? 0 : 1] ?? k}
                    {said}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {(c.counted ?? []).map((k) =>
        COUNTS[k] ? (
          <p key={k} className="m-0 text-[13.5px] text-ink-dim">
            {COUNTS[k]}
          </p>
        ) : null,
      )}
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
      <h3 id={id} className="m-0 grow text-[14px] font-semibold">
        {title}
      </h3>
      {children}
    </div>
  );
}
