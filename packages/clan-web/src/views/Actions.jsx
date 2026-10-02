import { Fresh, Icon, ago } from "@elixir-mcp/ui";
import { useState } from "react";
import { keys, useAction, useActions, useInvalidate } from "../lib/queries.js";
import { ActionCard, STATUS, TypeIcon } from "../components/ActionCard.jsx";
import { TooFew } from "../components/TooFew.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { trackEvent } from "../analytics.js";
import { CLAN, clanPath } from "../lib/base.js";

const ORDER = [
  "departure",
  "removal",
  "promotion",
  "demotion",
  "awards_announcement",
  "rules_announcement",
  "welcome",
  "away",
];

const LEADERS = new Set(["leader", "coLeader"]);

/** An action's own address: the one people send each other. */
const actionPath = (clan, number) =>
  `${clanPath(clan.clan_tag)}/actions/${number}`;

/** Who an action is about, in a word or a name. */
const about = (a) =>
  a.audience?.kind === "member"
    ? "You"
    : a.player_tag
      ? (a.player_name ?? a.player_tag)
      : "The clan";

/** The page's refusals, the same on the list and on one action. */
function Refused({ state, query, head }) {
  if (state.error === "too_few_members") {
    const e = query.data?.data ?? {};
    return (
      <>
        {head}
        <TooFew members={e.members} min={e.min_members} />
      </>
    );
  }
  if (state.error === "no_policy")
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No policy yet</div>
          <p className="empty__body">
            Actions start when this clan&rsquo;s leaders set up how the clan
            runs here.
          </p>
        </div>
      </>
    );
  return (
    <>
      {head}
      <div className="callout callout--warn" role="alert">
        <span>
          {state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet."
            : "Elixir did not answer. Try again in a minute."}
        </span>
      </div>
    </>
  );
}

/** One line of the list: the kind's mark, the number and what, who it
 *  is about and its comments, and when (or how it closed); the whole line
 *  opens the action's own page. */
function ActionRow({ action, clan, navigate }) {
  const n = action.number;
  const open = action.status === "proposed";
  const comments = (action.log ?? []).filter(
    (e) => e.kind === "comment",
  ).length;
  const line = (
    <>
      <TypeIcon type={action.type} />
      <span className="grid min-w-0 flex-auto gap-0.5">
        <span className="text-[14px] font-semibold text-ink">
          {Number.isInteger(n) ? (
            <span className="mono mr-2 font-normal text-ink-faint">#{n}</span>
          ) : null}
          {action.label}
        </span>
        <span className="text-[12.5px] text-ink-dim">
          {about(action)}
          {comments ? ` · ${comments} comment${comments === 1 ? "" : "s"}` : ""}
        </span>
      </span>
      <span className="shrink-0 self-center">
        {open ? (
          <span className="whitespace-nowrap text-[12px] text-ink-faint">
            {ago(action.raised_at)}
          </span>
        ) : (
          <span className={`chip ${STATUS[action.status]?.[1] ?? ""}`.trim()}>
            {STATUS[action.status]?.[0] ?? action.status}
          </span>
        )}
      </span>
    </>
  );
  const cls = "flex items-start gap-3 px-4 py-3.5";
  if (!Number.isInteger(n))
    return (
      <li className={cls} data-action={action.card_id}>
        {line}
      </li>
    );
  const href = actionPath(clan, n);
  return (
    <li data-action={action.card_id}>
      <a
        className={`${cls} text-ink no-underline hover:bg-panel-raised`}
        href={href}
        onClick={(e) => {
          if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          navigate(href);
        }}
      >
        {line}
      </a>
    </li>
  );
}

/** A list of actions in its own panel: its name, its count, its lines. */
function ActionList({ id, title, tone, actions, clan, navigate, foot }) {
  return (
    <section className="panel overflow-hidden" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="m-0 grow text-[14px] font-semibold">
          {title}
        </h2>
        <span className={`chip ${tone}`}>{actions.length}</span>
      </div>
      <ul className="m-0 list-none divide-y divide-line-row p-0">
        {actions.map((a) => (
          <ActionRow
            key={a.card_id}
            action={a}
            clan={clan}
            navigate={navigate}
          />
        ))}
      </ul>
      {foot ? (
        <div className="panel__foot text-[12.5px] text-ink-faint">{foot}</div>
      ) : null}
    </section>
  );
}

/**
 * Actions, for everyone in a clan with a policy: a list of what is
 * waiting for you (assigned to you, or open to your role) and what closed
 * in the last 30 days, one line each (Jamie, 2026-09-25: the page of full
 * actions was too long). Each line opens the action's own page. Opening
 * the list evaluates the clan, so actions are raised by whoever looks
 * first.
 */
export function Actions({ clan, who, navigate }) {
  const { state, query } = useActions(clan.clan_tag);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const d = state.data;
  const head = (
    <PageHead
      clan={clan}
      crumb="Actions"
      title="Actions"
      lede="What the policy suggests and the roster asks for. You decide each one in the game, then here. Nobody below co-leader sees removals or who is on a clock."
      navigate={navigate}
      fresh={
        d?.as_of ? (
          <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
        ) : null
      }
    />
  );
  if (state.error) return <Refused state={state} query={query} head={head} />;
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading the record…</p>
      </>
    );
  const rank = (t) => {
    const i = ORDER.indexOf(t);
    return i < 0 ? ORDER.length : i;
  };
  const open = [...d.open].sort(
    (a, b) => rank(a.type) - rank(b.type) || (a.number ?? 0) - (b.number ?? 0),
  );
  const history = `${clanPath(clan.clan_tag)}/manage/history`;
  const leads = LEADERS.has(who?.role ?? clan.role);
  return (
    <>
      {head}
      {/* Door 2: the morning email, and where it is switched off (Elixir's). */}
      <p className="page-head__note mt-0 mb-4">
        On a morning when something new here is yours to do, Elixir emails you
        what is waiting.{" "}
        <a href="https://elixir.poapkings.com/console/account/profile/email">
          Change that in Elixir
        </a>
        .
      </p>
      <div className="grid items-start gap-4 wide:grid-cols-2">
        {open.length === 0 ? (
          <div className="empty">
            <div className="empty__title">Nothing waiting for you</div>
            <p className="empty__body">
              An action appears here when the clan&rsquo;s policy suggests
              something you can do: for you alone, or for anyone in your role.
            </p>
          </div>
        ) : (
          <ActionList
            id="actions-waiting"
            title="Waiting for you"
            tone="chip--info"
            actions={open}
            clan={clan}
            navigate={navigate}
          />
        )}
        {d.recent.length ? (
          <ActionList
            id="actions-closed"
            title="Closed in the last 30 days"
            tone="chip--mute"
            actions={d.recent}
            clan={clan}
            navigate={navigate}
            foot={
              leads ? (
                <>
                  Every decided action stays in{" "}
                  <a
                    href={history}
                    onClick={(e) => {
                      if (!navigate) return;
                      e.preventDefault();
                      navigate(history);
                    }}
                  >
                    History ›
                  </a>
                </>
              ) : null
            }
          />
        ) : null}
      </div>
    </>
  );
}

/** Copy the action's address, to send to someone in the clan. */
function CopyLink({ path }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(
            `${window.location.origin}${path}`,
          );
          trackEvent("clan.action_link_copied");
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // The address is in the browser's bar to copy by hand.
        }
      }}
    >
      <Icon name={done ? "check" : "copy"} size={14} />
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * One action by its number (`/clan/<TAG>/actions/37`, Jamie 2026-09-25:
 * "take a look at action 37"): the whole action with its log open and a
 * place to comment, so the people it is for work it out here. Only those
 * the action is for can open it; anyone else is told there is no such
 * action here, the same answer as a number that does not exist.
 */
export function ActionDetail({ clan, who, number, navigate }) {
  const { state, query } = useAction(clan.clan_tag, number);
  const invalidate = useInvalidate();
  const changed = () => {
    invalidate(keys.actions(clan.clan_tag));
    invalidate(keys.me);
  };
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const list = `${clanPath(clan.clan_tag)}/actions`;
  const head = (
    <PageHead
      clan={clan}
      via={{ label: "Actions", to: list }}
      crumb={`#${number}`}
      title={`Action #${number}`}
      navigate={navigate}
    >
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={list}
          onClick={(e) => {
            if (!navigate) return;
            e.preventDefault();
            navigate(list);
          }}
        >
          ‹ All actions
        </a>
        <CopyLink path={actionPath(clan, number)} />
      </div>
    </PageHead>
  );
  if (state.error === "no_action")
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No action #{number} here</div>
          <p className="empty__body">
            It is not one of this clan&rsquo;s actions, or it is for someone
            else to take.
          </p>
        </div>
      </>
    );
  if (state.error) return <Refused state={state} query={query} head={head} />;
  const d = state.data;
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading the action…</p>
      </>
    );
  return (
    <>
      {head}
      <ActionCard
        action={d.action}
        clan={clan}
        who={who}
        reasons={d.decline_reasons}
        model={d.model ?? null}
        onChanged={changed}
        navigate={navigate}
      />
    </>
  );
}
