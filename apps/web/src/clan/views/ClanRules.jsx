import {
  ErrorState,
  Icon,
  Link,
  SplitBar,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { useEffect, useState } from "react";
import {
  CATEGORY_WORDS,
  directoryPolicy,
  ranksElder,
  removalDay,
  setMinimums,
} from "@elixir-mcp/clan-engine";
import { CLAN, clanPath } from "../lib/base.js";
import { CLAN_FULL, policyFacts } from "../lib/directory.js";
import { useMemberView, usePolicy, useRoster } from "../lib/queries.js";
import { leads } from "../lib/tabs.js";
import { PageHead } from "../components/PageHead.jsx";
import { ruleId, seesFor } from "../components/HouseRules.jsx";

/**
 * Rules, a tab for every member (2026-11-23): how the clan plays, as the
 * clan would show it to a friend. Its goals with your own number beside
 * each, how Elder is earned, how to stay in the clan, what the clan does
 * together, and a line to share it. The rules are public in the clan list,
 * so this shows nobody's standing, clock or hold but your own numbers;
 * past versions are the leaders' (the server sends a member none). Each
 * part keeps its address (`#rule-<key>`), where Standing's "Read the rule"
 * lands. Changing the rules is Run's.
 */

const num = (v) => Number(v).toLocaleString("en-US");

/** A weekly goal as a number and what it counts. */
const GOAL_WORDS = {
  war: (v) => noun(v, "war deck"),
  ranked: (v) => noun(v, "ranked battle"),
  donations: () => "cards donated a week",
  trophies: () => "trophies",
};

const linesOf = (how, key) => how?.find((s) => s.key === key)?.lines ?? [];

function Part({ id, title, sees, lines = [], children }) {
  return (
    <article
      id={ruleId(id)}
      className={`kit-rule kit-rule--${id}`}
      aria-labelledby={`${ruleId(id)}-title`}
    >
      <h3 id={`${ruleId(id)}-title`} className="kit-rule__title">
        {title}
      </h3>
      {children}
      {lines.length ? (
        <div className="kit-rule__lines">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {sees ? <p className="kit-rule__sees">{sees}</p> : null}
    </article>
  );
}

function Weekly({ values, how, mine }) {
  const goals = Object.entries(setMinimums(values));
  if (!goals.length) return null;
  const weeks = values.minimums_window_weeks;
  const which = values.minimums_rule === "all" ? "all" : "one";
  const title =
    weeks === 1
      ? `Each week, do ${which} of these`
      : `Over ${weeks} weeks, do ${which} of these`;
  const have = mine?.have ?? null;
  return (
    <Part
      id="minimums"
      title={title}
      sees={seesFor("minimums", values)}
      lines={linesOf(how, "minimums")}
    >
      <ul className="rules-show__goals">
        {goals.map(([c, need]) => {
          const you = have?.[c];
          return (
            <li key={c} className="rules-show__goal">
              <b>{num(need)}</b>
              <span>{GOAL_WORDS[c](need)}</span>
              {you === null || you === undefined ? null : (
                <span
                  className="rules-show__you"
                  data-met={mine.met?.[c] === true ? "true" : undefined}
                >
                  You: {num(Math.floor(you))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {mine ? (
        <p className="m-0 text-body-sm">
          {mine.passes
            ? "You're doing your part."
            : mine.unknown
              ? "Elixir can't tell yet whether you're doing your part."
              : "Not yet. Any of these gets you there."}
        </p>
      ) : null}
    </Part>
  );
}

function Elder({ values, how, weights }) {
  const ranked = ranksElder(values);
  return (
    <Part
      id="elder"
      title="Becoming Elder"
      sees={seesFor("elder", values)}
      lines={linesOf(how, "elder")}
    >
      {ranked && weights?.length ? (
        <SplitBar
          label="What makes a best player"
          parts={weights.map((w) => ({
            key: w.key,
            label: w.label,
            share: Math.round(w.share * 100),
          }))}
        />
      ) : null}
      <p className="m-0">
        {ranked
          ? `Elder is earned. About ${Math.round(values.band_ceiling_share * 100)}% of members are Elders. New members wait ${values.tenure_min_days} ${noun(values.tenure_min_days, "day")}.`
          : "The Leaders pick Elders by hand."}
      </p>
    </Part>
  );
}

function Staying({ values, how, away, navigate }) {
  if (!values.removal_enabled)
    return (
      <Part id="removal" title="Staying in the clan">
        <p className="m-0">Nobody is kicked for being quiet.</p>
      </Part>
    );
  const kick = removalDay(values);
  const days = [
    ["quiet", "Quiet", values.watch_days],
    ["warning", "Warning", values.at_risk_days],
    ["kick", "Leaders decide", kick],
  ];
  return (
    <Part
      id="removal"
      title="Staying in the clan"
      sees={seesFor("removal", values)}
      lines={linesOf(how, "removal")}
    >
      <p className="m-0">
        Play a battle at least once every {values.at_risk_days}{" "}
        {noun(values.at_risk_days, "day")}.
      </p>
      <ol className="rules-days" aria-label="Days with no battle">
        {days.map(([step, name, d]) => (
          <li key={step} className="rules-days__step" data-step={step}>
            <span className="rules-days__name">{name}</span>
            <span>
              {d} {noun(d, "day")}
            </span>
          </li>
        ))}
      </ol>
      {values.away_max_days > 0 ? (
        <div className="rules-show__share">
          <p className="m-0 grow">
            Going away? Tell us, for up to {values.away_max_days}{" "}
            {noun(values.away_max_days, "day")}.
          </p>
          <Link to={away} navigate={navigate} className="btn btn--sm">
            I&rsquo;ll be away
          </Link>
        </div>
      ) : null}
    </Part>
  );
}

function Together({ values, how }) {
  const counted = directoryPolicy(values).counted;
  const lines = [
    ...linesOf(how, "about"),
    ...linesOf(how, "counts"),
    ...linesOf(how, "welcome"),
  ];
  return (
    <Part
      id="about"
      title="What we do together"
      sees={seesFor("about", values)}
      lines={lines}
    >
      <p className="m-0">
        {counted.length
          ? `We count ${counted.map((c) => CATEGORY_WORDS[c].toLowerCase()).join(", ")}.`
          : "We don't count anything the game measures."}
        {values.goal_together ? " We like to play together." : ""}
      </p>
    </Part>
  );
}

function Share({ clan, navigate }) {
  const [copied, setCopied] = useState(false);
  const q = encodeURIComponent(clan.clan_tag);
  const path = `${CLAN}/directory?q=${q}`;
  const link =
    typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <Part id="share" title="Know someone who'd fit?">
      <p className="m-0">
        Send them your clan&rsquo;s card in Elixir&rsquo;s clan list.
      </p>
      <div className="rules-show__share">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              // The link is on screen to select by hand.
            }
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Link copied" : "Copy the link"}
        </button>
        <Link to={path} navigate={navigate} className="btn btn--sm">
          See it in the clan list
        </Link>
      </div>
      <p className="page-head__note m-0 break-all">{link}</p>
    </Part>
  );
}

export function ClanRules({ clan, navigate }) {
  const { whenDay } = useClock();
  const { data, isError, refetch, isFetching } = usePolicy(clan.clan_tag);
  const roster = useRoster(clan.clan_tag).state.data ?? null;
  const mine = useMemberView(clan.clan_tag).state.data?.clan?.minimums ?? null;
  const name = clan.name ?? clan.clan_tag;
  const base = clanPath(clan.clan_tag);
  const lead = leads(clan);
  const title = `How ${name} plays`;
  // Standing's "Read the rule" lands on its part (`#rule-<key>`).
  const ready = Boolean(data?.set);
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("rule-"))
      document.getElementById(hash)?.scrollIntoView?.({ block: "start" });
  }, [ready]);
  const editLink = lead ? (
    <Link
      to={`${base}/run/rules`}
      navigate={navigate}
      className={data?.set ? "btn" : "btn btn--primary"}
    >
      {data?.set ? "Change it in Run" : "Set it up in Run"}
    </Link>
  ) : null;
  if (isError)
    return (
      <>
        <PageHead title={title} />
        <ErrorState
          title="The rules could not be read just now"
          onRetry={() => refetch()}
          busy={isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </>
    );
  if (!data)
    return (
      <>
        <PageHead title={title} />
        <p className="page__lede">Reading the rules…</p>
      </>
    );
  if (!data.set)
    return (
      <div className="grid gap-4">
        <PageHead title={title} />
        <div className="kit-rule kit-rule--empty">
          <p className="m-0">
            {lead
              ? "This clan has no rules yet. Nothing in Clan runs until they're saved: no standing, no suggestions, no kicks."
              : "This clan has no rules yet. Its Leader or a Co-Leader sets them in Elixir, and until then nothing in Clan runs."}
          </p>
          {editLink ? <div>{editLink}</div> : null}
        </div>
      </div>
    );
  const current = data.current ?? {};
  const values = current.values ?? {};
  const chips = [
    ...policyFacts(directoryPolicy(values)),
    ranksElder(values) ? "Elder is earned" : null,
    values.removal_enabled
      ? `Kick after ${removalDay(values)} quiet days`
      : null,
  ].filter(Boolean);
  const record = [
    roster?.member_count === null || roster?.member_count === undefined
      ? null
      : `${roster.member_count} of ${CLAN_FULL} members`,
    roster?.required_trophies === null ||
    roster?.required_trophies === undefined
      ? null
      : `${num(roster.required_trophies)} trophies to join`,
  ].filter(Boolean);
  const saved = [
    current.version ? `Rules v${current.version}` : null,
    current.saved_at ? `saved ${whenDay(current.saved_at)}` : null,
    current.saved_by_name ? `by ${current.saved_by_name}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const summary = linesOf(data.how, "about")[0] ?? null;
  return (
    <div className="rules-show">
      <div className="rules-show__head">
        <PageHead title={title} lede={summary} fresh={editLink} />
        <ul className="clan-dir__facts" aria-label="The rules in short">
          {chips.map((t) => (
            <li key={t} className="kit-fact">
              {t}
            </li>
          ))}
          {record.map((t) => (
            <li key={t} className="kit-fact">
              {t}
            </li>
          ))}
        </ul>
        {saved ? <p className="kit-rules__saved m-0">{saved}.</p> : null}
      </div>
      <div className="kit-rules">
        <Weekly values={values} how={data.how} mine={mine} />
        <Elder values={values} how={data.how} weights={data.weights} />
        <Staying
          values={values}
          how={data.how}
          away={`${base}/members/away`}
          navigate={navigate}
        />
        <Together values={values} how={data.how} />
        <Share clan={clan} navigate={navigate} />
      </div>
      <p className="kit-rules__saved">
        Leaders set these in Run, Rules. Questions? Ask a leader in clan chat.
      </p>
      <p className="kit-rules__saved">
        Notes about a member: Elders read the Elders&rsquo; notes, and the
        Leader and Co-Leaders read every note. Closed Actions and past versions
        of the rules are for the Leader and Co-Leaders.
      </p>
    </div>
  );
}
