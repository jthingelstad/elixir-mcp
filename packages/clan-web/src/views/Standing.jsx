import { useState } from "react";
import { Fresh, Spark } from "@elixir-mcp/ui";
import { useStanding } from "../lib/queries.js";
import { clanPath } from "../lib/base.js";
import { TooFew } from "../components/TooFew.jsx";
import { ReportThis } from "../components/ReportThis.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { MemberLink } from "../components/MemberLink.jsx";
import { RoleChip } from "../components/RoleChip.jsx";

/** Each group as the canvas draws it: its chip, the 3px bar on its head
 *  and what it means in a member's words. A long group opens at `shown`
 *  rows (Participating, the clan's middle, opens closed). */
const STATUS = {
  holding: {
    label: "Holding Elder",
    chip: "chip--ok",
    bar: "shadow-[inset_3px_0_0_var(--ok)]",
    says: "Elders the policy keeps",
    shown: 5,
  },
  slipping: {
    label: "Slipping",
    chip: "chip--warn",
    bar: "shadow-[inset_3px_0_0_var(--warn)]",
    says: "Elders falling short of what the policy keeps",
    shown: 5,
  },
  rising: {
    label: "Rising",
    chip: "chip--info",
    bar: "shadow-[inset_3px_0_0_var(--accent-bright)]",
    says: "Members nearing Elder",
    shown: 5,
  },
  participating: {
    label: "Participating",
    chip: "chip--mute",
    bar: "shadow-[inset_3px_0_0_var(--line-strong)]",
    says: "Taking part, outside the Elder band",
    shown: 0,
  },
  quiet: {
    label: "Quiet",
    chip: "chip--mute",
    bar: "shadow-[inset_3px_0_0_var(--line-strong)]",
    says: "Little recorded play in what the clan counts",
    shown: 5,
  },
};
const ORDER = ["holding", "slipping", "rising", "participating", "quiet"];
/** A group longer than this opens at its `shown` rows. */
const LONG = 6;
const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
const LEADERS = new Set(["leader", "coLeader"]);

const race = (w) => `${w.season_id}/${w.section_index}`;
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
    <section className="panel overflow-hidden" aria-labelledby={id}>
      <div className={`panel__head ${s.bar}`}>
        <h2 id={id} className="m-0 text-[14px] font-semibold">
          {s.label}
        </h2>
        <span className={`chip ${s.chip}`.trim()}>{rows.length}</span>
        <span className="grow text-[12.5px] font-normal text-ink-faint">
          {s.says}
        </span>
      </div>
      {shown.length ? (
        <div tabIndex={0} className="table__scroll">
          <table className="table">
            <tbody>
              {shown.map((r) => {
                const mine = r.player_tag === you;
                return (
                  <tr
                    key={r.player_tag}
                    data-you={mine ? "true" : undefined}
                    className={mine ? "bg-panel-raised" : undefined}
                  >
                    <td className="whitespace-nowrap">
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
                    </td>
                    {war ? (
                      <td className="w-px">
                        <Spark
                          label={`${r.name}'s war decks`}
                          points={points(r.war)}
                        />
                      </td>
                    ) : null}
                    <td className="whitespace-normal text-right text-[12.5px] text-ink-dim">
                      {r.evidence || (
                        <span className="nil">nothing recorded</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
    </section>
  );
}

/** How the clan runs, from its policy: what Elder weighs (as bars, when
 *  Elder is ranked) and every section in a member's words. A leader can
 *  open the policy itself. */
function How({ d, clan, who, navigate }) {
  const policy = `${clanPath(clan.clan_tag)}/manage/policy`;
  return (
    <section className="panel" aria-labelledby="standing-how">
      <div className="panel__head">
        <h2 id="standing-how" className="m-0 grow text-[14px] font-semibold">
          How it works here
        </h2>
        {d.policy_version ? (
          <span className="chip chip--info">policy v{d.policy_version}</span>
        ) : null}
      </div>
      <div className="panel__body grid gap-4">
        {d.weights?.length ? (
          <div className="grid gap-3 pb-4 border-b border-line-soft">
            {d.weights.map((w) => {
              const pct = Math.round(w.share * 100);
              return (
                <div key={w.key} className="grid gap-1.5">
                  <span className="flex items-baseline gap-2">
                    <span className="grow text-[14px] font-semibold">
                      {w.label}
                    </span>
                    <span className="font-mono text-[15px]">{pct}%</span>
                  </span>
                  <svg
                    className="block w-full h-2 rounded-full overflow-hidden"
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect
                      width="100"
                      height="8"
                      className="fill-ground-sunken"
                    />
                    <rect width={pct} height="8" className="fill-accent" />
                  </svg>
                </div>
              );
            })}
          </div>
        ) : null}
        {d.how.map((section) => (
          <div key={section.key} className="grid gap-1">
            <h3 className="label m-0">{section.title}</h3>
            {section.lines.map((line) => (
              <p
                key={line}
                className="m-0 text-[13.5px] leading-[1.55] text-ink-body"
              >
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
      {LEADERS.has(who?.role) ? (
        <div className="panel__foot">
          <a
            href={policy}
            onClick={(e) => {
              if (!navigate) return;
              e.preventDefault();
              navigate(policy);
            }}
          >
            Read the policy in full ›
          </a>
        </div>
      ) : null}
    </section>
  );
}

/** Your own line: your group (or your role, when the policy does not band
 *  you), your war decks per race, the evidence and what would move it. */
function You({ you, who }) {
  const war = points(you.war);
  const played = war.reduce((n, p) => n + (p.value ?? 0), 0);
  const asked = war.reduce((n, p) => n + p.of, 0);
  const s = you.status ? STATUS[you.status] : null;
  return (
    <section className="panel" aria-labelledby="standing-you">
      <div className="panel__head">
        <h2 id="standing-you" className="m-0 grow text-[14px] font-semibold">
          You
        </h2>
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
        <p className="m-0">{you.evidence || "Nothing recorded yet."}</p>
        {you.next.map((n) => (
          <p key={n} className="m-0 text-[13.5px] text-ink-dim">
            → {n}
          </p>
        ))}
        {you.inactivity ? (
          <div className="callout callout--warn">
            <span>
              The last recorded activity marker is {Math.floor(you.days_idle)}{" "}
              days old. This does not establish no play across every battle
              mode.
            </span>
          </div>
        ) : null}
        {you.hold ? (
          <div className="notice">
            A leader has you on hold
            {you.hold.until ? ` until ${you.hold.until.slice(0, 10)}` : ""}.
          </div>
        ) : null}
      </div>
      {war.length ? (
        <div className="panel__foot text-[12.5px] text-ink-faint">
          {war.length === 1
            ? `Race ${war[0].label}.`
            : `Races ${war[0].label} to ${war[war.length - 1].label}.`}
        </div>
      ) : null}
    </section>
  );
}

/** Standing, for everyone in a clan with a policy: how the clan runs, in
 *  a member's words and straight from its policy; your own line; and, when
 *  Elder is ranked and the policy shares it, who holds Elder, who is rising
 *  and who is slipping, each with their own evidence in a player's terms.
 *  Never a score, a rank, or the slot count. */
export function Standing({ clan, who, navigate }) {
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
      clan={clan}
      crumb="Standing"
      title="Standing"
      lede="How each member's part reads against the clan's own policy. Facts come from Elixir's record; the judgment is the policy's, and every change is a leader's call."
      navigate={navigate}
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
      {/* A standing is Elixir's judgment against the clan's policy: when
          it reads wrong, the policy version rides along (2026-10-08). */}
      {state.data ? (
        <div>
          <ReportThis
            about={`Standing in ${clan.name ?? clan.clan_tag}${state.data.policy_version ? `, policy v${state.data.policy_version}` : ""}. Name the member and what reads wrong.`}
            refs={[
              { kind: "clan", ref: clan.clan_tag },
              ...(state.data.policy_version
                ? [{ kind: "policy", ref: `v${state.data.policy_version}` }]
                : []),
            ]}
            context={{ page: "standing" }}
          />
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
        <TooFew members={state.tooFew.members} min={state.tooFew.min_members} />
      </>
    );
  if (state.noPolicy)
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No policy yet</div>
          <p className="empty__body">
            This clan&rsquo;s leaders have not set up how the clan runs here.
          </p>
        </div>
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
  const you = d.you ? <You you={d.you} who={who} /> : null;
  return (
    <>
      {head}
      {groups.length ? (
        <div className="grid gap-4 items-start wide:grid-cols-3">
          <div className="grid gap-4 content-start">
            {how}
            {you}
          </div>
          <div className="grid gap-3.5 content-start wide:col-span-2">
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
        </div>
      ) : (
        <div className="grid gap-4 items-start wide:grid-cols-2">
          {how}
          {you}
        </div>
      )}
      {groups.length ? (
        <p className="page-head__note mt-4 mb-0">
          Standing is participation in what this clan counts, compared across
          its members and Elders over the windows the policy sets.
          {war
            ? " Bars are war decks in each race the war window reads, out of the decks asked."
            : ""}{" "}
          Leaders and co-leaders are not banded.
        </p>
      ) : null}
    </>
  );
}
