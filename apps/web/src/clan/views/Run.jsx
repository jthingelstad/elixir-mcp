import { Icon, Link, NavigateProvider, Panel, Row, Rows } from "@elixir-mcp/ui";
import { rulesCheck } from "@elixir-mcp/clan-engine";
import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import { clanPath } from "../lib/base.js";
import { useAwards, useExceptions, useRunGate } from "../lib/queries.js";
import { leads, waitingFor } from "../lib/tabs.js";
import { PageHead } from "../components/PageHead.jsx";
import { PanelBoundary, ReadError } from "../components/ReadError.jsx";
import { ActivityDiscordSetting } from "./ActivityDiscordSetting.jsx";
import { AwardsConfig } from "./Awards.jsx";
import { DiscordSetting } from "./DiscordSetting.jsx";
import { Model } from "./Model.jsx";
import { LEAVE_POLICY, usePolicyDraft } from "./Policy.jsx";
import { RunRules } from "./RunRules.jsx";
import { Sharing } from "./Sharing.jsx";
import { SocialSetting } from "./SocialSetting.jsx";
import { VoiceSetting } from "./VoiceSetting.jsx";
import { ActionsNow, Decided, RefreshSuggestions } from "./Waiting.jsx";
import { RunExceptions, setByLeaders } from "./RunExceptions.jsx";
import { RunMember } from "./RunMember.jsx";
import { RunMembers } from "./RunMembers.jsx";

/**
 * Run's tabs (the Run redesign, 2026-11-24), in the order a leader works:
 * what to do, who is in the clan, who the rules leave alone, the rules, and
 * what is set once. Each tab owns the pages under it; `""` is `/run` itself.
 */
const TABS = [
  { key: "todo", label: "To do", pages: ["", "actions", "decided"] },
  { key: "members", label: "Members", pages: ["members"] },
  { key: "exceptions", label: "Exceptions", pages: ["exceptions"] },
  { key: "rules", label: "Rules", pages: ["rules"] },
  {
    key: "setup",
    label: "Setup",
    pages: ["setup", "awards-setup", "discord", "model-voice", "settings"],
  },
];
/** The pages Setup gathers, each its own page with its own save. */
const SETUP = [
  {
    slug: "awards-setup",
    title: "Awards setup",
    detail: "Which awards the clan gives each season.",
  },
  {
    slug: "discord",
    title: "Discord",
    detail: "Send Actions and clan news to your Discord.",
  },
  {
    slug: "model-voice",
    title: "Model & voice",
    detail: "Your Anthropic key, and how drafts sound.",
  },
  {
    slug: "settings",
    title: "Clan settings",
    detail: "The member map, and what Elixir records.",
  },
];
const tabOfPage = (page) => TABS.find((t) => t.pages.includes(page ?? ""));
const setupOf = (slug) => SETUP.find((p) => p.slug === slug);

/** Asks before leaving Run with an unsaved draft: moving between its tabs
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

/** The Exceptions tab's count: the ones leaders set. Nothing while it reads
 *  or when the read fails; the tab still opens. */
function useExceptionCount(clanTag) {
  const { state } = useExceptions(clanTag);
  return state.data?.leader ? setByLeaders(state.data.exceptions).length : 0;
}

/** Run's five tabs. They wrap onto a second line on a narrow phone rather
 *  than scroll, and the Rules tab carries the draft's mark. */
function RunTabs({ e, me, clan, base, current, navigate }) {
  const exceptions = useExceptionCount(clan.clan_tag);
  const counts = {
    todo: [waitingFor(me), "waiting"],
    exceptions: [exceptions, "set by leaders"],
  };
  const edited = Boolean(e.view) && e.changed.length > 0;
  const wrong =
    Boolean(e.view) &&
    (Object.keys(e.errors).length > 0 ||
      rulesCheck(e.draft).some((f) => f.kind === "invalid"));
  return (
    <nav className="clan-run__tabs" aria-label="Run">
      <ul>
        {TABS.map((t) => {
          const [count, says] = counts[t.key] ?? [0, ""];
          return (
            <li key={t.key}>
              <Link
                to={t.key === "todo" ? base : `${base}/${t.key}`}
                navigate={navigate}
                aria-current={current === t.key ? "page" : undefined}
              >
                {t.label}
                {count ? (
                  <em className="clan-run__count">
                    {count}
                    <span className="sr-only"> {says}</span>
                  </em>
                ) : null}
                {t.key === "rules" ? (
                  <Mark edited={edited} wrong={wrong} />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** To do's two lists: what waits, and what was decided. */
function ToDoLists({ base, decided, navigate }) {
  const lists = [
    { key: "waiting", label: "Waiting", to: base, on: !decided },
    { key: "decided", label: "Decided", to: `${base}/decided`, on: decided },
  ];
  return (
    <nav className="kit-chips" aria-label="To do">
      {lists.map((l) => (
        <Link
          key={l.key}
          to={l.to}
          navigate={navigate}
          className="kit-chip"
          aria-current={l.on ? "page" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** The one way back from a page under Setup. */
function SetupBack({ base, navigate }) {
  return (
    <Link to={`${base}/setup`} navigate={navigate} className="clan-run__up">
      <Icon name="chevron-left" size={16} />
      Setup
    </Link>
  );
}

/** Setup: what is set once and left alone, a row per page. */
function Setup({ base, navigate }) {
  const rows = (
    <Rows>
      {SETUP.map((p) => (
        <Row
          key={p.slug}
          href={`${base}/${p.slug}`}
          title={p.title}
          detail={p.detail}
          right={<Icon name="chevron-right" size={16} />}
        />
      ))}
    </Rows>
  );
  return (
    <div className="grid gap-4">
      <PageHead
        title="Setup"
        lede="Set once, then leave alone. Each page saves on its own."
      />
      <Panel as="nav" aria-label="Setup">
        {navigate ? (
          <NavigateProvider navigate={navigate}>{rows}</NavigateProvider>
        ) : (
          rows
        )}
      </Panel>
    </div>
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
      <ReadError
        what="Awards"
        failure={state}
        onRetry={() => load()}
        busy={state.loading}
      />
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

/** Every page but the rules: each saves on its own. */
function Elsewhere({ clan, who, slug, player, base, navigate }) {
  // To do: the leaders' Actions, what waits and what was decided.
  if (slug === "" || slug === "actions" || slug === "decided") {
    const decided = slug === "decided";
    return (
      <div className="grid gap-4">
        <PageHead
          title="To do"
          fresh={decided ? null : <RefreshSuggestions clan={clan} />}
          lede="What the rules say to do next. Do it in the game, then tap Done."
        >
          <ToDoLists base={base} decided={decided} navigate={navigate} />
        </PageHead>
        <PanelBoundary what={decided ? "Decided" : "Actions"}>
          {decided ? (
            <Decided clan={clan} navigate={navigate} />
          ) : (
            <ActionsNow clan={clan} who={who} navigate={navigate} />
          )}
        </PanelBoundary>
      </div>
    );
  }
  if (slug === "setup") return <Setup base={base} navigate={navigate} />;
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
        &amp; voice under Setup.
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
 * Run's tabs and the page open under them. The tabs and the page are one
 * component, so a rules draft outlives every move between tabs, and each
 * page sits in its own boundary: one that fails to read or to draw says so
 * in its place, and the tabs and the draft stay.
 */
function RunSections({ clan, me, who, section, player, navigate }) {
  const e = usePolicyDraft(clan);
  const base = `${clanPath(clan.clan_tag)}/run`;
  const page = tabOfPage(section) ? (section ?? "") : "";
  const tab = tabOfPage(page).key;
  const dirty = Boolean(e.view && e.dirty);
  useEffect(() => {
    // Review folded into Members on 2026-11-23; its address goes there.
    if (section === "review") navigate?.(`${base}/members`, { replace: true });
    else if (section && !tabOfPage(section))
      navigate?.(base, { replace: true });
  }, [section, base, navigate]);
  useOldSettingsAnchor({ slug: page, base, navigate });
  const setup = setupOf(page);
  return (
    <div className="clan-run">
      <LeaveGuard when={dirty} runPath={base} />
      <RunTabs
        e={e}
        me={me}
        clan={clan}
        base={base}
        current={tab}
        navigate={navigate}
      />
      <div className="clan-run__section">
        {setup ? <SetupBack base={base} navigate={navigate} /> : null}
        <PanelBoundary
          key={`${page}/${player ?? ""}`}
          what={setup?.title ?? TABS.find((t) => t.key === tab).label}
        >
          {page !== "rules" ? (
            <Elsewhere
              clan={clan}
              who={who}
              slug={page}
              player={page === "members" ? player : undefined}
              base={base}
              navigate={navigate}
            />
          ) : e.policy.isError ? (
            <>
              <PageHead title="Rules" />
              <ReadError
                what="The rules"
                failure={e.policy.error}
                onRetry={() => e.policy.refetch()}
                busy={e.policy.isFetching}
              />
            </>
          ) : !e.view ? (
            <p className="page__lede">Loading the rules…</p>
          ) : (
            <RunRules e={e} clan={clan} />
          )}
        </PanelBoundary>
      </div>
    </div>
  );
}
