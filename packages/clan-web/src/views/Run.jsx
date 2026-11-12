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
import {
  LEAVE_POLICY,
  POLICY_SECTIONS,
  PolicyFoot,
  PolicyHead,
  PolicySection,
  policyStatus,
  usePolicyDraft,
} from "./Policy.jsx";
import { Sharing } from "./Sharing.jsx";
import { SocialSetting } from "./SocialSetting.jsx";
import { VoiceSetting } from "./VoiceSetting.jsx";
import { ActionsNow, Decided, RefreshSuggestions } from "./Waiting.jsx";

/** Run's list, in the order a leader reads it. */
const SIDE = [
  { head: "Actions", items: ["actions", "decided"] },
  { head: "Policy", items: ["about"] },
  {
    head: "What counts",
    items: ["minimums", "clan-wars", "ranked", "donations", "trophy-road"],
  },
  { head: "People", items: ["elder", "inactivity", "arrivals", "departures"] },
  { head: "Telling the clan", items: ["announcements"] },
  {
    head: "Elsewhere",
    items: ["awards-setup", "discord", "model-voice", "settings"],
  },
];
const ELSEWHERE = {
  actions: "Waiting",
  decided: "Decided",
  "awards-setup": "Awards setup",
  discord: "Discord",
  "model-voice": "Model & voice",
  settings: "Clan settings",
};
const titleOf = (slug) => POLICY_SECTIONS[slug]?.title ?? ELSEWHERE[slug];

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
    const s = POLICY_SECTIONS[slug];
    if (!s || !e.view) return {};
    const fields = e.fieldsOf(s);
    return {
      state: e.stateOf(s),
      edited: fields.some((k) => e.changed.includes(k)),
      wrong: fields.some((k) => e.errors[k]),
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
                  <a
                    href={to}
                    aria-current={current === slug ? "page" : undefined}
                    onClick={(ev) => {
                      ev.preventDefault();
                      navigate?.(to);
                    }}
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
                  </a>
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
        Save the clan&rsquo;s policy first. Awards setup opens after that.
      </p>
    );
  if (state.forbidden || (state.error && state.error !== "too_few_members"))
    return (
      <p className="page-head__note m-0" role="alert">
        Awards could not be read just now. Try again shortly.
      </p>
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

/** What is not the policy: each saves on its own. */
function Elsewhere({ clan, who, slug, navigate }) {
  // The leaders' Actions (Today's Waiting and Decided until 2026-11-12).
  if (slug === "actions")
    return (
      <div className="grid gap-4">
        <PageHead
          title="Waiting"
          fresh={<RefreshSuggestions clan={clan} />}
          lede="What the clan's policy suggests you can do. The same actions are first in the Feed."
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
            <h3 className="m-0 text-[14px] font-semibold">
              Actions in Discord
            </h3>
            <DiscordSetting clan={clan} />
          </div>
        </section>
        <section className="panel" aria-label="Activity channel">
          <div className="panel__body grid gap-3">
            <h3 className="m-0 text-[14px] font-semibold">Activity channel</h3>
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
          <h3 className="m-0 grow text-[14px] font-semibold">
            Recording and visibility
          </h3>
          <span className="page-head__note font-normal">
            Read only, always on
          </span>
        </div>
        <div className="panel__body">
          <Sharing clan={clan} />
        </div>
      </section>
      <p className="page-head__note m-0">
        Other clan settings live with what they change: the policy under Policy,
        What counts and People; the recruiting pitch in Members › Recruit;
        Discord and Model &amp; voice above.
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
 *  no to. How the clan runs is every member's, under Policy. */
function RunRefused({ clan, navigate }) {
  const policy = `${clanPath(clan.clan_tag)}/policy`;
  return (
    <div className="grid gap-4">
      <PageHead title="Run" />
      <div className="callout callout--warn" role="alert">
        <span>
          Run is for the clan&rsquo;s leader and co-leaders, verified in Elixir.
          How the clan runs is under Policy, for every member.
        </span>
        <a
          className="btn btn--sm"
          href={policy}
          onClick={(ev) => {
            ev.preventDefault();
            navigate?.(policy);
          }}
        >
          Open Policy
        </a>
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
function RunSections({ clan, who, section, navigate }) {
  const e = usePolicyDraft(clan);
  const base = `${clanPath(clan.clan_tag)}/run`;
  const slug = titleOf(section) ? section : "actions";
  const go = (s) => navigate?.(`${base}/${s}`);
  const isPolicy = Boolean(POLICY_SECTIONS[slug]);
  const dirty = Boolean(e.view && e.dirty);
  useEffect(() => {
    if (section && !titleOf(section)) navigate?.(base, { replace: true });
  }, [section, base, navigate]);
  useOldSettingsAnchor({ slug, base, navigate });
  const failed = e.policy.isError;
  const readError =
    e.policy.error?.status === 403
      ? "Policy is unavailable for your current clan access."
      : e.policy.error?.status === 401
        ? "Your session expired. Sign in again."
        : "Elixir did not answer the policy read. Try again in a minute.";
  return (
    <div className={`clan-run${section ? "" : " clan-run--index"}`}>
      <LeaveGuard when={dirty} runPath={base} />
      <RunList e={e} base={base} current={slug} navigate={navigate} />
      {dirty && e.view.can_edit ? (
        <div className="clan-run__listsave">
          <span className="page-head__note" role="status">
            {policyStatus(e)}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={e.busy || !e.canSave}
            onClick={() => e.save(go)}
          >
            {e.view.set ? "Save as new version" : "Save this clan's policy"}
          </button>
        </div>
      ) : null}
      <div className="clan-run__section">
        <a
          className="clan-run__back"
          href={base}
          onClick={(ev) => {
            ev.preventDefault();
            navigate?.(base);
          }}
        >
          ‹ Run
        </a>
        {!isPolicy ? (
          <Elsewhere clan={clan} who={who} slug={slug} navigate={navigate} />
        ) : failed ? (
          <>
            <PageHead title={titleOf(slug)} />
            <div className="callout callout--warn" role="alert">
              <span>{readError}</span>
            </div>
          </>
        ) : !e.view ? (
          <p className="page__lede">Loading the policy…</p>
        ) : (
          <>
            <PageHead
              title={
                slug === "about" && !e.view.set
                  ? "Set up how the clan runs"
                  : titleOf(slug)
              }
            />
            <PolicyHead e={e} slug={slug} clan={clan} />
            <section className="panel" aria-label={titleOf(slug)}>
              <PolicySection e={e} slug={slug} go={go} />
            </section>
            <PolicyFoot e={e} go={go} />
          </>
        )}
      </div>
    </div>
  );
}
