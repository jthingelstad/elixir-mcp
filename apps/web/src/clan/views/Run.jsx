import { Link, ErrorState, Icon, noun } from "@elixir-mcp/ui";
import { rulesCheck } from "@elixir-mcp/clan-engine";
import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import { clanPath } from "../lib/base.js";
import { useAwards, useRunGate } from "../lib/queries.js";
import { leads } from "../lib/tabs.js";
import { PageHead } from "../components/PageHead.jsx";
import { ActivityDiscordSetting } from "./ActivityDiscordSetting.jsx";
import { AwardsConfig } from "./Awards.jsx";
import { DiscordSetting } from "./DiscordSetting.jsx";
import { Model } from "./Model.jsx";
import { LEAVE_POLICY, usePolicyDraft } from "./Policy.jsx";
import { RunRules, changeLines } from "./RunRules.jsx";
import { Sharing } from "./Sharing.jsx";
import { SocialSetting } from "./SocialSetting.jsx";
import { VoiceSetting } from "./VoiceSetting.jsx";
import { ActionsNow, Decided, RefreshSuggestions } from "./Waiting.jsx";
import { RunExceptions } from "./RunExceptions.jsx";
import { RunMember } from "./RunMember.jsx";
import { RunMembers } from "./RunMembers.jsx";

/** Run's list, in the order a leader reads it. */
const SIDE = [
  { head: "Actions", items: ["actions", "decided", "members"] },
  { head: "How it runs", items: ["rules", "exceptions"] },
  {
    head: "Elsewhere",
    items: ["awards-setup", "discord", "model-voice", "settings"],
  },
];
const ELSEWHERE = {
  actions: "Waiting",
  decided: "Decided",
  members: "Members",
  rules: "Rules",
  exceptions: "Exceptions",
  "awards-setup": "Awards setup",
  discord: "Discord",
  "model-voice": "Model & voice",
  settings: "Clan settings",
};
const titleOf = (slug) => ELSEWHERE[slug];

/** Asks before leaving Run with an unsaved draft: moving between its sections
 *  keeps the draft, so only a way out of Run asks. */
function LeaveGuard({ when, runPath }) {
  useBlocker({
    shouldBlockFn: ({ next }) =>
      when &&
      next.pathname !== runPath &&
      !next.pathname.startsWith(`${runPath}/`) &&
      !window.confirm(LEAVE_POLICY),
    enableBeforeUnload: () => when,
  });
  return null;
}

function Mark({ edited, wrong }) {
  if (wrong)
    return (
      <em className="clan-run__mark clan-run__mark--bad">
        <span aria-hidden="true">!</span>
        <span className="sr-only">needs a fix</span>
      </em>
    );
  if (edited)
    return (
      <em className="clan-run__mark">
        <span aria-hidden="true">•</span>
        <span className="sr-only">changed</span>
      </em>
    );
  return null;
}

/** The list of Run's sections, marked with what the draft holds. */
function RunList({ e, base, current, navigate }) {
  const facts = (slug) => {
    if (slug !== "rules" || !e.view) return {};
    return {
      state: e.view.set ? `v${e.view.current.version}` : "not set",
      edited: e.changed.length > 0,
      wrong:
        Object.keys(e.errors).length > 0 ||
        rulesCheck(e.draft).some((f) => f.kind === "invalid"),
    };
  };
  return (
    <nav className="clan-run__list" aria-label="Run">
      {SIDE.map((g) => (
        <div key={g.head}>
          <h2 className="label">{g.head}</h2>
          <ul>
            {g.items.map((slug) => {
              const { state, edited, wrong } = facts(slug);
              const to = `${base}/${slug}`;
              return (
                <li key={slug}>
                  <Link
                    to={to}
                    navigate={navigate}
                    aria-current={current === slug ? "page" : undefined}
                  >
                    <span>
                      {titleOf(slug)}
                      <Mark edited={edited} wrong={wrong} />
                    </span>
                    <span className="clan-run__state">
                      {state === "on" || state === "off" ? (
                        <>
                          <i
                            aria-hidden="true"
                            className={
                              state === "on"
                                ? "clan-run__dot clan-run__dot--on"
                                : "clan-run__dot"
                            }
                          />
                          <span className="sr-only">
                            {state === "on" ? "On" : "Off"}
                          </span>
                        </>
                      ) : (
                        state
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AwardsSetup({ clan }) {
  const { state, load } = useAwards(clan.clan_tag);
  if (state.error === "no_policy")
    return (
      <p className="page__lede m-0">
        Save the clan&rsquo;s rules first. Awards setup opens after that.
      </p>
    );
  if (state.forbidden || (state.error && state.error !== "too_few_members"))
    return (
      <ErrorState
        title="Awards could not be read just now"
        onRetry={() => load()}
        busy={state.loading}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (!state.data)
    return state.error ? (
      <p className="page__lede m-0">
        Awards setup opens at ten members, with the rest of clan management.
      </p>
    ) : (
      <p className="page__lede m-0">Reading the awards…</p>
    );
  return (
    <>
      <p className="page-head__note m-0">
        Awards v{state.data.config_version}.
      </p>
      <AwardsConfig
        key={state.data.config_version}
        clan={clan}
        view={state.data}
        onDone={() => load(true)}
      />
    </>
  );
}

/** What is not the rules: each saves on its own. */
function Elsewhere({ clan, who, slug, player, navigate }) {
  // The leaders' Actions (Today's Waiting and Decided until 2026-11-12).
  if (slug === "actions")
    return (
      <div className="grid gap-4">
        <PageHead
          title="Waiting"
          fresh={<RefreshSuggestions clan={clan} />}
          lede="What the clan's rules suggest you can do. The same actions are first in the Timeline."
        />
        <ActionsNow clan={clan} who={who} navigate={navigate} />
      </div>
    );
  if (slug === "decided")
    return (
      <div className="grid gap-4">
        <PageHead title="Decided" />
        <Decided clan={clan} navigate={navigate} />
      </div>
    );
  // Every member and where they stand, with one member's page under it
  // (2026-11-23; Review until then). The API refuses both to everyone else.
  if (slug === "members")
    return player ? (
      <RunMember clan={clan} who={who} player={player} navigate={navigate} />
    ) : (
      <RunMembers clan={clan} navigate={navigate} />
    );
  // Members the rules leave alone (2026-11-23, holds before).
  if (slug === "exceptions")
    return <RunExceptions clan={clan} navigate={navigate} />;
  if (slug === "awards-setup")
    return (
      <div className="grid gap-4">
        <PageHead title="Awards setup" />
        <AwardsSetup clan={clan} />
      </div>
    );
  if (slug === "discord")
    return (
      <div className="grid gap-4">
        <PageHead
          title="Discord"
          lede="Two channels, each with its own webhook. Actions go to a channel your leaders read. Activity goes to one the clan reads. Each saves on its own."
        />
        <section className="panel" aria-label="Actions in Discord">
          <div className="panel__body grid gap-3">
            <h3 className="kit-panel__title">Actions in Discord</h3>
            <DiscordSetting clan={clan} />
          </div>
        </section>
        <section className="panel" aria-label="Activity channel">
          <div className="panel__body grid gap-3">
            <h3 className="kit-panel__title">Activity channel</h3>
            <p className="page-head__note m-0">
              The clan&rsquo;s activity, posted as short stories.
            </p>
            <ActivityDiscordSetting clan={clan} navigate={navigate} />
          </div>
        </section>
      </div>
    );
  if (slug === "model-voice")
    return (
      <div className="grid gap-4">
        <PageHead
          title="Model & voice"
          lede="Your Anthropic account pays for model use. Review message drafts before sending; optional Discord activity editing can post without review. Each setting saves on its own."
        />
        <div id="settings-model" className="grid gap-4">
          <Model clan={clan} />
        </div>
        <section
          id="settings-voice"
          className="panel"
          aria-label="How our messages sound"
        >
          <div className="panel__body">
            <VoiceSetting clan={clan} />
          </div>
        </section>
      </div>
    );
  return (
    <div className="grid gap-4">
      <PageHead title="Clan settings" />
      <section className="panel" aria-label="Member map">
        <div className="panel__body">
          <SocialSetting clan={clan} />
        </div>
      </section>
      <section className="panel" aria-label="Recording and visibility">
        <div className="panel__head">
          <h3 className="kit-panel__title grow">Recording and visibility</h3>
          <span className="page-head__note font-normal">
            Read only, always on
          </span>
        </div>
        <div className="panel__body">
          <Sharing clan={clan} />
        </div>
      </section>
      <p className="page-head__note m-0">
        Other clan settings live with what they change: the rules under Rules;
        the recruiting pitch in Members › Spread the word; Discord and Model
        &amp; voice above.
      </p>
    </div>
  );
}

/** The old Settings page's anchors, still in links people kept. Those two
 *  sections are on Model & voice now, so the address goes there and the page
 *  jumps once what loads above them has settled. */
const OLD_ANCHORS = new Set(["#settings-model", "#settings-voice"]);
const SETTLE_MS = 1500;

function useOldSettingsAnchor({ slug, base, navigate }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (!OLD_ANCHORS.has(hash)) return undefined;
    if (slug === "settings") {
      navigate?.(`${base}/model-voice${hash}`, { replace: true });
      return undefined;
    }
    if (slug !== "model-voice") return undefined;
    const jump = () => document.getElementById(hash.slice(1))?.scrollIntoView();
    jump();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(jump);
    watch.observe(document.body);
    const stop = setTimeout(() => watch.disconnect(), SETTLE_MS);
    return () => {
      clearTimeout(stop);
      watch.disconnect();
    };
  }, [slug, base, navigate]);
}

/** Run refused: a member, an unverified leader, or anyone the server said
 *  no to. How the clan runs is every member's, under Rules. */
function RunRefused({ clan, navigate }) {
  const rules = `${clanPath(clan.clan_tag)}/rules`;
  return (
    <div className="grid gap-4">
      <PageHead title="Run" />
      <div className="callout callout--warn" role="alert">
        <span>
          Run is for the clan&rsquo;s leader and co-leaders, verified in Elixir.
          How the clan runs is under Rules, for every member.
        </span>
        <Link to={rules} navigate={navigate} className="btn btn--sm">
          Open Rules
        </Link>
      </div>
    </div>
  );
}

/**
 * Run: how the clan is run, for the leader and co-leaders, with their
 * Actions first (Clan as one view, slice 8, #766). The tab is hidden from
 * everyone else, and the server refuses its reads to them (`GET .../run`,
 * 403 leaders_only); a refusal draws as one.
 */
export function Run(props) {
  const { clan, navigate } = props;
  const lead = leads(clan);
  const { state } = useRunGate(clan.clan_tag, lead);
  if (!lead || state.forbidden)
    return <RunRefused clan={clan} navigate={navigate} />;
  return <RunSections {...props} />;
}

/**
 * Run's sections. On a wide screen the list stands beside the section and
 * `/run` opens Waiting; on a phone `/run` is the list and each section has a
 * way back to it. The two are one page, so a draft outlives every move
 * between sections, and CSS alone picks what shows.
 */
function RunSections({ clan, who, section, player, navigate }) {
  const e = usePolicyDraft(clan);
  const base = `${clanPath(clan.clan_tag)}/run`;
  const slug = titleOf(section) ? section : "actions";
  // A save refused from the list opens Rules, where the problem is marked.
  const go = () => {
    if (slug !== "rules") navigate?.(`${base}/rules`);
  };
  const isPolicy = slug === "rules";
  const dirty = Boolean(e.view && e.dirty);
  useEffect(() => {
    // Review folded into Members on 2026-11-23; its address goes there.
    if (section === "review") navigate?.(`${base}/members`, { replace: true });
    else if (section && !titleOf(section)) navigate?.(base, { replace: true });
  }, [section, base, navigate]);
  useOldSettingsAnchor({ slug, base, navigate });
  const failed = e.policy.isError;
  const readError =
    e.policy.error?.status === 403
      ? "The rules are unavailable for your current clan access."
      : e.policy.error?.status === 401
        ? "Your session expired. Sign in again."
        : "Try again in a moment.";
  const changes = e.view ? changeLines(e).length : 0;
  return (
    <div className={`clan-run${section ? "" : " clan-run--index"}`}>
      <LeaveGuard when={dirty} runPath={base} />
      <RunList e={e} base={base} current={slug} navigate={navigate} />
      {dirty && e.view.can_edit ? (
        <div className="clan-run__listsave">
          <span className="page-head__note" role="status">
            {changes
              ? `You changed ${changes} ${noun(changes, "thing")}.`
              : "Your rules aren't saved yet."}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={e.busy || !e.canSave}
            onClick={() => e.save(go)}
          >
            Save rules
          </button>
        </div>
      ) : null}
      <div className="clan-run__section">
        <Link to={base} navigate={navigate} className="clan-run__back">
          <Icon name="chevron-left" size={16} />
          Run
        </Link>
        {!isPolicy ? (
          <Elsewhere
            clan={clan}
            who={who}
            slug={slug}
            player={slug === "members" ? player : undefined}
            navigate={navigate}
          />
        ) : failed ? (
          <>
            <PageHead title={titleOf(slug)} />
            <ErrorState
              title="The rules could not be read just now"
              onRetry={
                e.policy.error?.status === 403 || e.policy.error?.status === 401
                  ? undefined
                  : () => e.policy.refetch()
              }
              busy={e.policy.isFetching}
            >
              {readError}
            </ErrorState>
          </>
        ) : !e.view ? (
          <p className="page__lede">Loading the rules…</p>
        ) : (
          <RunRules e={e} clan={clan} />
        )}
      </div>
    </div>
  );
}
