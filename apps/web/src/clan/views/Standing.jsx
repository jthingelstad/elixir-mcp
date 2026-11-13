import { useState } from "react";
import { Disclosure, Fresh, Spark, Panel, Empty, Table } from "@elixir-mcp/ui";
import { useStanding } from "../lib/queries.js";
import { clanPath } from "../lib/base.js";
import { ROLE, seasonWeek } from "../lib/words.js";
import { holdWords } from "../components/YouHereCard.jsx";
import { ReportThis } from "../components/ReportThis.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { MemberLink } from "../components/MemberLink.jsx";
import { HouseRules, ruleId, ruleTitle } from "../components/HouseRules.jsx";
import { RoleChip } from "../components/RoleChip.jsx";

/** Each group as the canvas draws it: its chip, the 3px bar on its head
 *  and what it means in a member's words. A long group opens at `shown`
 *  rows (Participating, the clan's middle, opens closed). */
const STATUS = {
  holding: {
    label: "Holding Elder",
    chip: "chip--ok",
    bar: "shadow-[inset_3px_0_0_var(--ok)]",
    says: "Elders the policy keeps.",
    shown: 5,
  },
  slipping: {
    label: "Slipping",
    chip: "chip--warn",
    bar: "shadow-[inset_3px_0_0_var(--warn)]",
    says: "Elders falling short of what the policy keeps.",
    shown: 5,
  },
  rising: {
    label: "Rising",
    chip: "chip--info",
    bar: "shadow-[inset_3px_0_0_var(--accent-bright)]",
    says: "Members nearing Elder.",
    shown: 5,
  },
  participating: {
    label: "Participating",
    chip: "chip--mute",
    bar: "shadow-[inset_3px_0_0_var(--line-strong)]",
    says: "Meeting the minimums, not near Elder yet.",
    shown: 0,
  },
  quiet: {
    label: "Quiet",
    chip: "chip--mute",
    bar: "shadow-[inset_3px_0_0_var(--line-strong)]",
    says: "Little recorded play in what the clan counts.",
    shown: 5,
  },
};
const ORDER = ["holding", "slipping", "rising", "participating", "quiet"];
/** A group longer than this opens at its `shown` rows. */
const LONG = 6;
const LEADERS = new Set(["leader", "coLeader"]);

const race = (w) => seasonWeek(w);
const points = (war) =>
  (war ?? []).map((w) => ({
    label: race(w),
    value: w.decks,
    of: w.decks_asked,
  }));

/** One group of members, its own panel: who is in it, each with their war
 *  decks per race when the clan counts war, and their evidence. Your row
 *  is marked and always shows, even while the group is closed. */
function Group({ status, rows, you, war, clan, navigate }) {
  const s = STATUS[status];
  const long = rows.length > LONG;
  const [open, setOpen] = useState(!long);
  const shown = open
    ? rows
    : rows.filter((r, i) => i < s.shown || r.player_tag === you);
  const id = `standing-${status}`;
  return (
    <Panel className="overflow-hidden" aria-labelledby={id}>
      <div className={`panel__head ${s.bar}`}>
        <h3 id={id} className="m-0 text-[14px] font-semibold">
          {s.label}
        </h3>
        <span className={`chip ${s.chip}`.trim()}>{rows.length}</span>
        <span className="grow text-[12.5px] font-normal text-ink-faint">
          {s.says}
        </span>
      </div>
      {shown.length ? (
        <Table
          columns={[
            {
              head: "",
              className: "whitespace-nowrap",
              cell: (r) => {
                const mine = r.player_tag === you;
                return (
                  <>
                    {mine ? <span className="yours">★ </span> : null}
                    <span
                      className={mine ? "font-semibold" : "font-medium"}
                      title={r.player_tag}
                    >
                      <MemberLink
                        clanTag={clan.clan_tag}
                        playerTag={r.player_tag}
                        navigate={navigate}
                      >
                        {r.name}
                      </MemberLink>
                    </span>
                    {mine ? (
                      <span className="chip chip--info ml-2">you</span>
                    ) : null}
                  </>
                );
              },
            },
            ...(war
              ? [
                  {
                    head: "",
                    className: "w-px",
                    cell: (r) => (
                      <Spark
                        label={`${r.name}'s war decks`}
                        points={points(r.war)}
                      />
                    ),
                  },
                ]
              : []),
            {
              head: "",
              className:
                "whitespace-normal text-right text-[12.5px] text-ink-dim",
              cell: (r) =>
                r.evidence || <span className="nil">Nothing recorded yet</span>,
            },
          ]}
          rows={shown}
          rowKey={(r) => r.player_tag}
          rowProps={(r) => {
            const mine = r.player_tag === you;
            return {
              "data-you": mine ? "true" : undefined,
              className: mine ? "bg-panel-raised" : undefined,
            };
          }}
          noHead
        />
      ) : null}
      {long ? (
        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

/** How the clan runs, from its policy: its house rules, each card the
 *  policy's own sentences (and what Elder weighs, as bars, when Elder is
 *  ranked). A leader can open the policy itself. */
function How({ d, clan, who, navigate }) {
  const policy = `${clanPath(clan.clan_tag)}/run/about`;
  return (
    <Panel aria-labelledby="standing-how">
      <div className="panel__head">
        <h3 id="standing-how" className="m-0 grow text-[14px] font-semibold">
          How it works here
        </h3>
        {d.policy_version ? (
          <span className="chip chip--info">policy v{d.policy_version}</span>
        ) : null}
      </div>
      <div className="panel__body">
        <HouseRules how={d.how} weights={d.weights} />
      </div>
      {LEADERS.has(who?.role) ? (
        <div className="panel__foot">
          <a
            className="btn"
            href={policy}
            onClick={(e) => {
              if (!navigate) return;
              e.preventDefault();
              navigate(policy);
            }}
          >
            Read the policy in full, in Run
          </a>
        </div>
      ) : null}
    </Panel>
  );
}

/** Which of the policy's rules put a member where they are: Elder's for
 *  the Elder groups, the minimums for Participating and Quiet (the two
 *  differ only in passing them), the inactivity rule while the clock is
 *  running. */
export function ruleFor(you) {
  if (you.inactivity) return "removal";
  if (["holding", "slipping", "rising"].includes(you.status)) return "elder";
  if (["participating", "quiet"].includes(you.status)) return "minimums";
  return null;
}

/** The one sentence of that rule that speaks to the group: Elder's
 *  promotion and step-down line, or the rule's first line. */
function ruleLine(section, status) {
  if (section.key === "elder" && status !== null) {
    const line = section.lines.find((l) => /promotion needs/.test(l));
    if (line) return line;
  }
  return section.lines[0];
}

/** The rule behind your group: its sentence and a way to the whole rule. */
function WhyHere({ you, how, clan, navigate }) {
  const key = ruleFor(you);
  const section = key ? (how ?? []).find((s) => s.key === key) : null;
  if (!section?.lines?.length) return null;
  const to = `${clanPath(clan.clan_tag)}/policy`;
  return (
    <div className="kit-why">
      <span className="kit-why__label">The rule behind this</span>
      <p className="kit-why__line">{ruleLine(section, you.status)}</p>
      <a
        className="kit-why__link"
        href={`${to}#${ruleId(key)}`}
        onClick={(e) => {
          if (!navigate) return;
          e.preventDefault();
          navigate(to, { hash: ruleId(key) });
        }}
      >
        Read the rule: {ruleTitle(section)}
      </a>
    </div>
  );
}

/** Your own line: your group (or your role, when the policy does not band
 *  you), your war decks per race, the evidence and what would move it. */
function You({ you, who, how, clan, navigate }) {
  const war = points(you.war);
  const played = war.reduce((n, p) => n + (p.value ?? 0), 0);
  const asked = war.reduce((n, p) => n + p.of, 0);
  const s = you.status ? STATUS[you.status] : null;
  return (
    <Panel aria-labelledby="standing-you">
      <div className="panel__head">
        <h3 id="standing-you" className="m-0 grow text-[14px] font-semibold">
          You
        </h3>
      </div>
      <div className="panel__body grid gap-3">
        <div className="flex items-center gap-2.5">
          <span className="yours">★</span>
          <span className="grow text-[15px] font-semibold">
            {who?.name ?? "You"}
          </span>
          {s ? (
            <span className={`chip ${s.chip}`.trim()}>{s.label}</span>
          ) : who?.role ? (
            <RoleChip role={who.role} label={ROLE[who.role] ?? who.role} />
          ) : null}
        </div>
        {war.length ? (
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="w-[110px] text-[12.5px] text-ink-faint">
              War decks
            </span>
            <Spark label="Your war decks" points={war} />
            <span className="text-[12.5px] text-ink-dim">
              {played} of {asked}
            </span>
          </div>
        ) : null}
        <p className="m-0">
          {LEADERS.has(who?.role)
            ? "Leaders and co-leaders have no group. Your own numbers are on your page."
            : you.evidence || "Nothing recorded yet."}
        </p>
        {you.inactivity ? (
          <div className="callout callout--warn">
            <span>
              {Math.floor(you.days_idle)} days since your last battle; this clan
              counts a member at risk from {you.at_risk_days} days. Modes the
              battle log does not carry are not seen.
            </span>
          </div>
        ) : null}
        {you.hold ? <div className="notice">{holdWords(you.hold)}</div> : null}
        {LEADERS.has(who?.role) ? null : (
          <WhyHere you={you} how={how} clan={clan} navigate={navigate} />
        )}
      </div>
      {war.length ? (
        <div className="panel__foot text-[12.5px] text-ink-faint">
          {war.length === 1
            ? `${war[0].label}.`
            : `${war[0].label} to ${war[war.length - 1].label}.`}
        </div>
      ) : null}
    </Panel>
  );
}

/** Standing, for everyone in a clan with a policy: how the clan runs, in
 *  a member's words and straight from its policy; your own line; and, when
 *  Elder is ranked and the policy shares it, who holds Elder, who is rising
 *  and who is slipping, each with their own evidence in a player's terms.
 *  Never a score, a rank, or the slot count. */
export function Standing({ clan, who, navigate, fromRun = false }) {
  const standing = useStanding(clan.clan_tag);
  const env = standing.data;
  const state = !env
    ? standing.isError
      ? { error: true }
      : { loading: true }
    : env.status === 409 && env.data?.error === "too_few_members"
      ? { tooFew: env.data }
      : env.status === 409
        ? { noPolicy: true }
        : !env.ok
          ? { error: true }
          : { data: env.data };
  const head = (
    <PageHead
      title="Standing"
      fresh={
        state.data?.as_of ? (
          <Fresh
            label="as of"
            seconds={state.data.freshness_seconds}
            ts={state.data.as_of}
          />
        ) : null
      }
    >
      {fromRun ? (
        <div className="callout callout--info" role="status">
          <span>
            Run is for the leader and co-leaders. This is how the clan runs, the
            same rules every member reads.
          </span>
        </div>
      ) : null}
    </PageHead>
  );
  if (state.loading)
    return (
      <>
        {head}
        <p className="page__lede">Reading the record…</p>
      </>
    );
  if (state.tooFew)
    return (
      <>
        {head}
        <Empty
          title={`Clan management starts at ${state.tooFew.min_members} members`}
        >
          Clan management is paused below {state.tooFew.min_members} members, so
          Standing waits.
        </Empty>
      </>
    );
  if (state.noPolicy)
    return (
      <>
        {head}
        <Empty title="No policy yet">
          This clan&rsquo;s leaders have not set up how the clan runs here.
          Standing starts when they do.
        </Empty>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Elixir did not answer. Try again in a minute.</span>
        </div>
      </>
    );
  const d = state.data;
  const groups = ORDER.map((s) => [
    s,
    (d.rows ?? []).filter((r) => r.status === s),
  ]).filter(([, rows]) => rows.length);
  const war = groups.some(([, rows]) => rows.some((r) => r.war?.length));
  const how = <How d={d} clan={clan} who={who} navigate={navigate} />;
  const you = d.you ? (
    <You you={d.you} who={who} how={d.how} clan={clan} navigate={navigate} />
  ) : null;
  return (
    <>
      {head}
      {you}
      <Disclosure
        title={`How it works here${d.policy_version ? ` · Policy v${d.policy_version}` : ""}`}
        open={fromRun}
      >
        {how}
      </Disclosure>
      <div className="grid gap-5 mt-5">
        {groups.map(([status, rows]) => (
          <Group
            key={status}
            status={status}
            clan={clan}
            navigate={navigate}
            rows={rows}
            you={who?.player_tag}
            war={war}
          />
        ))}
      </div>
      {!groups.length && !d.rows?.length && d.you ? (
        <p className="page-head__note mt-4 mb-0">
          This clan&rsquo;s leaders keep the group lists to themselves. Your own
          line is above.
        </p>
      ) : null}
      {groups.length ? (
        <p className="page-head__note mt-4 mb-0">
          Standing is participation in what this clan counts, compared across
          its members and Elders over the windows the policy sets. It is a
          group.
          {war
            ? " Bars are war decks in each finished race the war window reads, out of the decks asked."
            : ""}{" "}
          Leaders and co-leaders have no group.
        </p>
      ) : null}
      {/* A standing is Elixir's reading against the clan's policy: when it reads
          wrong, the policy version rides along (2026-10-08). */}
      <div className="mt-3">
        <ReportThis
          about={`Standing in ${clan.name ?? clan.clan_tag}${d.policy_version ? `, policy v${d.policy_version}` : ""}. Name the member and what reads wrong.`}
          refs={[
            { kind: "clan", ref: clan.clan_tag },
            ...(d.policy_version
              ? [{ kind: "policy", ref: `v${d.policy_version}` }]
              : []),
          ]}
          context={{ page: "standing" }}
        />
      </div>
    </>
  );
}
