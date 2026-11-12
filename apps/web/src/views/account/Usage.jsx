import {
  Disclosure,
  Empty,
  ErrorState,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Stat,
  Stats,
  Table,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { limitsLabel } from "../../lib/words.js";
import { useUsage } from "../../lib/queries.js";
import { useScope, useScopedPath } from "../../lib/scope.js";
import { quotaReading } from "../../lib/quota.js";
import { SETTINGS } from "../../lib/settings.js";

/**
 * Usage and limits: your daily budget, where it went, and what your account
 * allows. An agent's Usage tab is the same reading of the same budget, with
 * how much of it this agent spent. The numbers come through lib/quota.js.
 */

/** Fourteen days ending today, zero-filled: the server only returns the
 *  days that had calls, and a quiet day is a real zero on the axis. */
function fourteenDays(days, now = new Date()) {
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  const out = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    out.push({
      day: key,
      calls: byDay.get(key)?.calls ?? 0,
      errors: byDay.get(key)?.errors ?? 0,
      // The website's and Ladder's own reads: logged, never charged (#538).
      web: byDay.get(key)?.web_calls ?? 0,
      today: i === 0,
    });
  }
  return out;
}

const dayLine = (d) =>
  `${d.calls.toLocaleString()} ${noun(d.calls, "call")}${d.errors ? `, ${d.errors} refused` : ""}${d.web ? `, ${d.web.toLocaleString()} of your own ${noun(d.web, "read")}, not counted` : ""}`;

const shortDay = (d) => d.day.slice(5);

function CallsPerDay({ days }) {
  const max = Math.max(...days.map((d) => d.calls), 1);
  return (
    <Panel
      title="Calls per day"
      titleAs="h2"
      action={<span className="hint">14 days, today still filling</span>}
    >
      <div
        className="st-bars"
        role="img"
        aria-label={`Calls per day for the last 14 days, up to ${max.toLocaleString()} a day`}
      >
        {days.map((d) => (
          <span
            key={d.day}
            title={`${d.day}: ${dayLine(d)}`}
            className={"st-bar" + (d.today ? " st-bar--today" : "")}
            // A bar's height is its value, the one thing CSS cannot know.
            style={{ height: `${Math.max(2, (d.calls / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="st-bars__axis mono">
        <span>{shortDay(days[0])}</span>
        <span>Today</span>
      </div>
      <Disclosure title="As a list">
        <ul className="st-list">
          {[...days].reverse().map((d) => (
            <li key={d.day}>
              {shortDay(d)}: {dayLine(d)}
              {d.today ? ", still filling" : ""}
            </li>
          ))}
        </ul>
      </Disclosure>
    </Panel>
  );
}

/** How the limits are held (#530): Member is signup, Leader and Family are
 *  earned in the game and read on every request, Partner is granted. */
const GROUND = {
  member: "Yours from signing up.",
  leader:
    "You earned these: one of your verified players leads or co-leads a clan you track.",
  family: "You run an active collector.",
  partner: "Granted.",
  admin: "Granted.",
  owner: "Yours as the owner.",
};

const NEXT = {
  member: [
    "Verify a player who leads or co-leads a clan you track, or run a collector for Elixir, and these rise.",
    "Verify a player",
    `${SETTINGS}/players/verify`,
  ],
  leader: [
    "Run a collector for Elixir and these rise.",
    "Run a collector",
    `${SETTINGS}/collectors/new`,
  ],
};

const cap = (v) =>
  v == null ? "No ceiling" : v === 0 ? "None" : v.toLocaleString();

function Allows({ me, usage }) {
  const e = me?.entitlements;
  if (!e) return null;
  const next = NEXT[me.role];
  return (
    <Panel
      title="What your account allows"
      titleAs="h2"
      action={<span className="chip chip--tier">{limitsLabel(me.role)}</span>}
    >
      <div className="panel__body st-page">
        <p className="m-0">{GROUND[me.role] ?? ""}</p>
        <Table
          phone="fit"
          minWidth={320}
          rowKey={([label]) => label}
          columns={[
            { head: "What", cell: ([label]) => label },
            {
              head: "Using",
              num: true,
              className: "mono",
              cell: ([, used]) => (used == null ? "" : used.toLocaleString()),
            },
            {
              head: "Allowed",
              num: true,
              className: "mono",
              cell: ([, , limit]) => cap(limit),
            },
          ]}
          rows={[
            ["Player slots used", e.player_slots?.used, e.player_slots?.limit],
            [
              "Clans, the clan only",
              e.activity_clans?.used,
              e.activity_clans?.limit,
            ],
            [
              "Clans, every member",
              e.comprehensive_clans?.used,
              e.comprehensive_clans?.limit,
            ],
            ["Calls a day", usage?.today_calls, e.mcp_calls_per_day],
            ["Live fetches a day", usage?.live_today, e.live_fetches_per_day],
            ["Agents", undefined, e.agents?.limit],
          ]}
        />
        {next ? (
          <p className="m-0">
            {next[0]}{" "}
            <Link className="btn btn--sm" to={next[2]}>
              {next[1]}
            </Link>
          </p>
        ) : null}
        <p className="st-foot m-0">
          These limits set what Elixir records for you, your daily budgets and
          how many agents you can have, never what you can read.{" "}
          <a href="/docs/roles#upgrades">How limits work</a>
        </p>
      </div>
    </Panel>
  );
}

function ByConnection({ callers }) {
  const top = Math.max(...callers.map((c) => c.calls), 1);
  return (
    <Panel
      title="By connection"
      titleAs="h2"
      action={<span className="hint">7 days</span>}
    >
      {callers.length === 0 ? (
        <p className="panel__body m-0 text-ink-faint">
          Nothing has called yet this week.
        </p>
      ) : (
        <ul className="st-meters">
          {callers.map((c) => (
            <li key={`${c.kind}:${c.name}`} className="st-meter">
              <span className="st-meter__name">
                {c.public_id ? (
                  <Link to={`${SETTINGS}/agents/${c.public_id}/usage`}>
                    {c.name}
                  </Link>
                ) : (
                  c.name
                )}
              </span>
              <span className="meter">
                <span
                  className="meter__fill"
                  // The bar's width is its value.
                  style={{ width: `${(c.calls / top) * 100}%` }}
                />
              </span>
              <span className="mono">{c.calls.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BusiestTools({ tools, path }) {
  return (
    <Panel
      title="Busiest tools"
      titleAs="h2"
      action={<span className="hint">7 days</span>}
    >
      {tools.length === 0 ? (
        <p className="panel__body m-0 text-ink-faint">
          No calls yet this week.
        </p>
      ) : (
        <ul className="st-meters">
          {tools.map((t) => (
            <li key={t.tool} className="st-meter st-meter--two">
              {/* The question a number here provokes is "which calls were
                  those", so it opens Requests filtered to this tool. */}
              <Link
                className="mono st-meter__name"
                to={`${path(`${SETTINGS}/usage/requests`)}?tool=${encodeURIComponent(t.tool)}`}
              >
                {t.tool}
              </Link>
              <span className="mono">{t.calls.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function Usage({ me }) {
  const { data: usage, error, refetch, isFetching } = useUsage();
  const { zone } = useClock();
  const scope = useScope();
  const path = useScopedPath();
  if (error && !usage)
    return (
      <ErrorState
        title="Could not load usage"
        onRetry={refetch}
        busy={isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (!usage)
    return (
      <p className="text-ink-faint" role="status">
        Reading today&rsquo;s spend.
      </p>
    );

  const quota = quotaReading(
    scope ? { ...usage, today_calls: usage.budget_today_calls } : usage,
    zone,
  );
  const days = fourteenDays(usage.days);
  const callers = usage.by_caller ?? [];
  const tools = usage.top_tools ?? [];
  const nothing =
    days.every((d) => d.calls === 0) &&
    callers.length === 0 &&
    tools.length === 0;

  if (scope)
    return (
      <div className="st-page">
        <p className="m-0">
          This agent spends your daily budget: it made{" "}
          {(usage.today_calls ?? 0).toLocaleString()} of the{" "}
          {(usage.budget_today_calls ?? 0).toLocaleString()} calls your budget
          paid for today. {quota.resets}.
        </p>
        <Stats>
          <Stat
            label="Your budget today"
            value={quota.calls.used.toLocaleString()}
            of={quota.calls.limit?.toLocaleString()}
          />
          <Stat
            label="Your live fetches today"
            value={quota.fetches.used.toLocaleString()}
            of={quota.fetches.limit?.toLocaleString()}
          />
          <Stat
            label="This agent today"
            value={(usage.today_calls ?? 0).toLocaleString()}
            note="calls"
          />
          <Stat
            label="This agent, 7 days"
            value={callers
              .reduce((n, c) => n + (c.calls ?? 0), 0)
              .toLocaleString()}
            note="calls"
          />
        </Stats>
        <Panel title="Its logs" titleAs="h2">
          <Rows>
            <Row
              title="Requests"
              detail="Every call it made, newest first"
              right="Open ›"
              href={path(`${SETTINGS}/usage/requests`)}
            />
            <Row
              title="Account events"
              detail="Changes to this agent's account, its access and what it records"
              right="Open ›"
              href={`${SETTINGS}/agents/${scope}/usage/events`}
            />
          </Rows>
        </Panel>
        <BusiestTools tools={tools} path={path} />
      </div>
    );

  return (
    <div className="st-page">
      <PageHead
        title="Usage and limits"
        sub="Your daily budget and where it went."
        aside={
          <Link className="btn btn--sm" to={`${SETTINGS}/usage/requests`}>
            Requests
          </Link>
        }
      />
      <p className="m-0">
        {quota.resets}.
        {usage.agent_calls_today > 0
          ? ` Your agents spent ${usage.agent_calls_today.toLocaleString()} of today's calls, and they draw on the same budget you do.`
          : ""}
        {usage.web_calls_today > 0
          ? ` Stats and these pages also read ${usage.web_calls_today.toLocaleString()} ${noun(usage.web_calls_today, "time")} for you today. Your own reads on Elixir's website aren't counted against the budget.`
          : ""}
      </p>
      <Stats>
        <Stat
          label="Calls today"
          value={quota.calls.used.toLocaleString()}
          of={quota.calls.limit?.toLocaleString()}
          tone={quota.calls.full ? "warn" : undefined}
        />
        <Stat
          label="Live fetches today"
          value={quota.fetches.used.toLocaleString()}
          of={quota.fetches.limit?.toLocaleString()}
          tone={quota.fetches.full ? "warn" : undefined}
        />
      </Stats>
      {nothing ? (
        <Empty
          title="No calls yet this week"
          titleAs="h2"
          action={
            <Link className="btn" to={`${SETTINGS}/connections`}>
              Connect an AI
            </Link>
          }
        >
          Connect an AI, and its calls appear here. Your own reads on
          Elixir&rsquo;s website are not counted.
        </Empty>
      ) : (
        <>
          <CallsPerDay days={days} />
          <div className="st-two">
            <ByConnection callers={callers} />
            <BusiestTools tools={tools} path={path} />
          </div>
          <Panel>
            <Rows>
              <Row
                title="Requests"
                detail="Every call your connections made, newest first"
                right="Open ›"
                href={`${SETTINGS}/usage/requests`}
              />
            </Rows>
          </Panel>
        </>
      )}
      <Allows me={me} usage={usage} />
    </div>
  );
}
