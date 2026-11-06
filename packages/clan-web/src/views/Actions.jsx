import { Icon, ago, TagText, useFlash, Panel, Empty } from "@elixir-mcp/ui";
import { keys, useAction, useInvalidate } from "../lib/queries.js";
import { ActionCard, STATUS, TypeIcon } from "../components/ActionCard.jsx";
import { TooFew } from "../components/TooFew.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { ReportThis } from "../components/ReportThis.jsx";
import { trackEvent } from "../analytics.js";
import { CLAN, clanPath } from "../lib/base.js";

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
function ActionRefused({ state, query, head }) {
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
        <Empty title="No policy yet">
          Actions start when this clan&rsquo;s leaders set up how the clan runs
          here.
        </Empty>
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
          <TagText>{about(action)}</TagText>
          {action.status !== "proposed" && action.delivery_channels?.length > 1
            ? " · Clan chat and Leader Message"
            : action.channel === "leader_message"
              ? " · Leader Message"
              : action.channel === "clan_chat"
                ? " · Clan chat"
                : ""}
          {comments ? ` · ${comments} comment${comments === 1 ? "" : "s"}` : ""}
          {action.removal_safety?.status === "held"
            ? " · No longer qualifies"
            : ""}
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
export function ActionList({ id, title, tone, actions, clan, navigate, foot }) {
  return (
    <Panel className="overflow-hidden" aria-labelledby={id}>
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
    </Panel>
  );
}

/**
 * The leaders' nudge toward Actions in Discord (Jamie, 2026-10-10): shown
 * to the leader and co-leaders while the clan has no webhook, or when
 * Discord stopped taking the one it has. Nothing when it works.
 */
export function DiscordNudge({ discord, to, navigate }) {
  if (!discord || (discord.set && !discord.refused)) return null;
  const go = (e) => {
    if (!navigate) return;
    e.preventDefault();
    trackEvent("clan.discord_nudge");
    navigate(to);
  };
  return (
    <div
      className={`callout ${discord.set ? "callout--warn" : "callout--info"} mb-4`}
      role="status"
    >
      <span>
        {discord.set
          ? "Discord stopped accepting the clan’s webhook, so Actions are not being posted there. "
          : "Post Actions to your leaders’ Discord channel: each new one appears there, and is marked when someone completes it. "}
        <a href={to} onClick={go}>
          {discord.set ? "Connect it again in Run" : "Set it up in Run"}
        </a>
      </span>
    </div>
  );
}

/** Copy the action's address, to send to someone in the clan. */
function CopyLink({ path }) {
  const [done, flash] = useFlash();
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
          flash();
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
    invalidate(keys.history(clan.clan_tag), { exact: true });
    invalidate(keys.me, { exact: true });
  };
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const list = `${clanPath(clan.clan_tag)}/today`;
  const a = state.data?.action;
  const head = (
    <>
      <a
        className="mb-2 inline-block"
        href={list}
        onClick={(e) => {
          if (!navigate) return;
          e.preventDefault();
          navigate(list);
        }}
      >
        ‹ Today
      </a>
      <PageHead
        title={
          a
            ? `${a.label}${a.player_name ? `: ${a.player_name}` : ""}`
            : `Action #${number}`
        }
        lede={
          a
            ? [
                `Action #${number}`,
                clan.name,
                a.raised_at ? `suggested ${ago(a.raised_at)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null
        }
        fresh={
          <div className="flex flex-wrap items-center gap-3">
            {a ? (
              <span
                className={`chip ${a.status === "proposed" ? "" : (STATUS[a.status]?.[1] ?? "")}`.trim()}
              >
                {a.status === "proposed"
                  ? "Open"
                  : (STATUS[a.status]?.[0] ?? a.status)}
              </span>
            ) : null}
            <CopyLink path={actionPath(clan, number)} />
            {a ? (
              <ReportThis
                about={`This action: ${a.label}${a.player_tag ? `, ${a.player_name ?? a.player_tag}` : ""}. Its evidence and the policy behind it ride along.`}
                refs={[
                  { kind: "clan_action", ref: String(a.card_id) },
                  { kind: "clan", ref: clan.clan_tag },
                  ...(a.player_tag
                    ? [{ kind: "player", ref: a.player_tag }]
                    : []),
                ]}
                context={{ action_type: a.type, status: a.status }}
              />
            ) : null}
          </div>
        }
      />
    </>
  );
  if (state.error === "no_action")
    return (
      <>
        {head}
        <Empty title={<>No action #{number} here</>}>
          It is not one of this clan&rsquo;s actions, or it is for someone else
          to take.
        </Empty>
      </>
    );
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            These Actions are unavailable for your current clan access.
          </span>
        </div>
      </>
    );
  if (state.error)
    return <ActionRefused state={state} query={query} head={head} />;
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
