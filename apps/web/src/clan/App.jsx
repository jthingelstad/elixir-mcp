import { sessionGeneration } from "@elixir-mcp/client";
import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation, useParams } from "@tanstack/react-router";
import { ErrorBoundary, FeedbackSheet } from "@elixir-mcp/ui";
import { api, feedbackApi } from "./api.js";
import { keys, useDirectory, useMeQuery } from "./lib/queries.js";
import { leads, pageOf, policyActive } from "./lib/tabs.js";
import { landingPath } from "./lib/landing.js";
import { useSelectClan } from "./lib/select.js";
import {
  CLAN,
  appPath,
  clanPath,
  isClanSegment,
  playerInClanPath,
  tagOf,
} from "./lib/base.js";
import { ClanHead } from "./components/ClanHead.jsx";
import { RoleConfirming } from "./components/RoleConfirming.jsx";
import {
  FEEDBACK_HISTORY,
  feedbackItemHref,
} from "./components/ReportThis.jsx";
import { Clan } from "./views/Clan.jsx";
import { Clans } from "./views/Clans.jsx";
import { Directory } from "./views/Directory.jsx";
import { Standing } from "./views/Standing.jsx";
import { Refused } from "./views/Refused.jsx";
import { Away } from "./views/Away.jsx";
import { Awards } from "./views/Awards.jsx";
import { ActionDetail } from "./views/Actions.jsx";
import { Feed } from "./views/Feed.jsx";
import { ClanPolicy } from "./views/ClanPolicy.jsx";
import { YouHere } from "./views/YouHere.jsx";
import { Season } from "./views/Season.jsx";
import { Run } from "./views/Run.jsx";
import { MembersBack } from "./views/Members.jsx";
import { VerifyPlayer } from "../components/VerifyPlayer.jsx";
import { Unavailable } from "../shell/Unavailable.jsx";
import { SETTINGS } from "../lib/settings.js";
import { useNav } from "../App.jsx";
// The clan map brings Leaflet and the place lists: loaded when opened.
const ClanMap = lazy(() =>
  import("./views/ClanMap.jsx").then((m) => ({ default: m.ClanMap })),
);

const neverChanges = () => () => {};
/** The map draws only in a browser. A lazy view in the server's
 *  renderToString aborts its boundary, and the browser then reports React
 *  #419 on every visit, so the server and hydration both draw the waiting
 *  line and the view loads after. */
function MapWhenInBrowser({ clan, me }) {
  const reading = <p className="page__lede">Reading…</p>;
  const inBrowser = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
  if (!inBrowser) return reading;
  return (
    <Suspense fallback={reading}>
      <ClanMap key={clan.clan_tag} clan={clan} me={me} />
    </Suspense>
  );
}

/**
 * Routes, all under Elixir's /clan (CLAN, lib/base.js): `/clan` (the chooser
 * for someone with no clan open), `/clan/clans` (the
 * whole chooser), `/clan/<TAG>/<tab>` with its pages (Feed, Standings, War,
 * Members, Policy and the leaders' Run), `/clan/verify` (the notice after
 * sign-in) and `/clan/refused/<reason>`. The app's own pages win over a tag.
 * The old tab addresses stopped working on 2026-11-13; apps/web's lib/moved.js
 * forwards only a clan's bare address and its Actions list.
 * The router owns history and params; the GATE - where a signed-in person
 * belongs, whatever address they arrived at - is the Shell's effect below,
 * because it is a session state machine (a refresh, a select) and not a
 * per-route loader. Signed out, the app's shell shows Elixir's sign-in page
 * (apps/web App.jsx, ClanOutlet) and none of this runs.
 */

/** `/clan/<TAG>/<section>[/<tab>]` parsed: the tag with its #, the tab and the
 *  page under it, or under actions the action's number
 *  (`/clan/<TAG>/actions/37`). */
export function parseClanPath(path) {
  const m =
    /^\/([^/]+)(?:\/(feed|standings|war|members|policy|run|actions)(?:\/([a-z0-9-]+))?)?\/?$/i.exec(
      appPath(path) ?? "",
    );
  const tag = m ? tagOf(m[1]) : null;
  if (!tag) return null;
  return { tag, section: m[2] ?? null, tab: m[3] ?? null };
}

/** The clan a `/clan/<TAG>...` path names, if it is one of the person's. */
export function clanFromPath(path, clans = []) {
  const parsed = parseClanPath(path);
  if (!parsed) return null;
  return clans.find((c) => c.clan_tag === parsed.tag) ?? null;
}

/** A query value as text. The app's router reads a query string as JSON
 *  where it can (`?q=2089` is the number 2089, `?find=true` a boolean), so
 *  a searched tag or a member's name is read back as the text typed. */
export function searchText(value) {
  return value === undefined ? null : String(value);
}

/** The person's clans, as a query on ["me", "clan"], under the app's
 *  session. A 401 reads as signed out, a transport failure or a 5xx as
 *  "unavailable" - signed in, Elixir did not answer - and never as signed
 *  out. `refresh(true)` is the server-side re-read (?refresh=1). */
function useClanMe() {
  const queryClient = useQueryClient();
  const query = useMeQuery();
  const generation = sessionGeneration(queryClient);
  const meOf = (env) => {
    if (!env) return null;
    if (env.status === 401)
      return {
        signed_in: false,
        expired: env.data?.reason === "session_expired",
      };
    if (!env.ok) return { signed_in: true, unavailable: true };
    return env.data;
  };
  const me = query.isError
    ? { signed_in: true, unavailable: true }
    : meOf(query.data);
  const { refetch } = query;
  const refresh = useCallback(
    async (force = false) => {
      if (force) {
        const r = await api.me(true);
        if (generation === sessionGeneration(queryClient))
          queryClient.setQueryData(keys.me, r);
        return meOf(r);
      }
      const r = await refetch();
      return meOf(r.data);
    },
    [refetch, queryClient, generation],
  );
  const setMe = useCallback(
    (data) => {
      if (generation === sessionGeneration(queryClient))
        queryClient.setQueryData(keys.me, { ok: true, status: 200, data });
    },
    [queryClient, generation],
  );
  return { me, checking: query.isFetching, refresh, setMe };
}

const SessionContext = createContext(null);
/** The person's clans and the clan chooser, for the pages. */
const useSession = () => useContext(SessionContext);

/** `/clan`: the chooser for someone with no clan open. With one open, the
 *  layout sends them to its Feed. */
export function LandingPage() {
  const { me, select, selecting } = useSession();
  return me?.ok && !me.selected ? (
    <Clans me={me} onSelect={select} selecting={selecting} />
  ) : null;
}

export function ClansPage() {
  const { me, select, selecting } = useSession();
  if (!me?.ok) return null;
  return <Clans me={me} onSelect={select} selecting={selecting} />;
}

/** The clan directory (#768): signed in is enough. Signed out, the app
 *  shows its sign-in page and this never runs. */
export function DirectoryPage() {
  const { me } = useSession();
  const signedIn = Boolean(me?.signed_in && !me.unavailable);
  const { state, load } = useDirectory(signedIn);
  const { search } = useLocation();
  if (!signedIn) return null;
  return (
    <Directory
      state={state}
      onRetry={() => load()}
      query={searchText(search.q) ?? ""}
    />
  );
}

/** One redirect the session has to answer, once it can. */
function Replace({ to, navigate }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}

/** A page under Members (the Map, Away): its way back to the roster, now
 *  that Members has no row of its own (G6, 2026-11-12). */
function MembersPage({ clan, children, navigate }) {
  return (
    <>
      <MembersBack clan={clan} navigate={navigate} />
      {children}
    </>
  );
}

export function ClanPage() {
  const { me } = useSession();
  const navigate = useNav();
  const { pathname, search } = useLocation();
  const parsed = parseClanPath(pathname);
  if (!me?.ok || !parsed) return null;
  const clan = clanFromPath(pathname, me.clans);
  if (!clan) return null;
  const base = clanPath(clan.clan_tag);
  const who = {
    player_tag: clan.acting_as,
    name: clan.acting_as_name,
    role: clan.role,
  };
  const find = (searchText(search.find) ?? "").slice(0, 100);
  const { section, tab } = parsed;
  if (section === "feed") {
    // A roster search at the clan's old bare address names the roster.
    if (searchText(search.find) !== null)
      return (
        <Replace
          to={`${base}/members?${new URLSearchParams({ find })}`}
          navigate={navigate}
        />
      );
    // Today's closed fold was the leaders' Decided: it is in Run now.
    if (search.show === "closed" && leads(clan))
      return <Replace to={`${base}/run/decided`} navigate={navigate} />;
    return (
      <Feed
        key={clan.clan_tag}
        me={me}
        clan={clan}
        who={who}
        navigate={navigate}
      />
    );
  }
  // One action, by its number: the address people send each other.
  if (section === "actions")
    return tab && /^[0-9]{1,7}$/.test(tab) ? (
      <ActionDetail
        key={`${clan.clan_tag}-${tab}`}
        clan={clan}
        who={who}
        number={Number(tab)}
        navigate={navigate}
      />
    ) : (
      <Replace to={`${base}/feed`} navigate={navigate} />
    );
  if (section === "war")
    return (
      <Season
        key={`${clan.clan_tag}-${tab ?? "latest"}`}
        clan={clan}
        period={tab}
        navigate={navigate}
      />
    );
  // Standings: where everyone stands under the policy, then the season's
  // awards. Standing was under Members until G6 (2026-11-12); it is still
  // every member's.
  if (section === "standings")
    return (
      <div className="grid gap-10">
        <section id="standing" aria-label="Standing">
          <Standing
            key={clan.clan_tag}
            clan={clan}
            who={who}
            navigate={navigate}
            fromRun={search.from === "run"}
          />
        </section>
        <section id="awards" aria-label="Awards">
          <Awards
            key={clan.clan_tag}
            clan={clan}
            who={who}
            me={me}
            season={tab}
            navigate={navigate}
            afterStanding
          />
        </section>
      </div>
    );
  if (section === "policy")
    return <ClanPolicy key={clan.clan_tag} clan={clan} navigate={navigate} />;
  if (section === "run") {
    // Run is the leaders'. Old mail's Decided and Waiting were every
    // member's Today: a member following one lands on the Feed.
    if (!leads(clan) && (tab === "decided" || tab === "actions"))
      return <Replace to={`${base}/feed`} navigate={navigate} />;
    return (
      <Run
        key={clan.clan_tag}
        clan={clan}
        me={me}
        who={who}
        section={tab}
        navigate={navigate}
      />
    );
  }
  // Members, and the pages under it.
  if (tab === "me")
    return (
      <Replace
        to={`${base}/members/${String(clan.acting_as).slice(1)}`}
        navigate={navigate}
      />
    );
  const page = (body) => (
    <MembersPage clan={clan} navigate={navigate}>
      {body}
    </MembersPage>
  );
  // Members' old row (G6, 2026-11-12): Standing and Review stopped working
  // on 2026-11-13. Recruit's pitch is in Spread
  // the word and Scout at the roster's foot, opened where the address asks;
  // both are the elders' and up (Jamie, 2026-11-12): anyone else who follows
  // either address gets its role line there, not the form or a read.
  if (tab === "recruit" || tab === "scout")
    return <Replace to={`${base}/members?show=${tab}`} navigate={navigate} />;
  if (tab === "map") return page(<MapWhenInBrowser clan={clan} me={me} />);
  if (tab === "away")
    return page(<Away key={clan.clan_tag} me={me} clan={clan} />);
  // Another member's page folded into their player page's Clan tab
  // (Jamie, 2026-11-12: one page); your own place here stays.
  if (tab && tagOf(tab)) {
    const own = tagOf(tab) === clan.acting_as;
    return own ? (
      <YouHere key={clan.clan_tag} clan={clan} navigate={navigate} />
    ) : (
      <Replace to={playerInClanPath(tagOf(tab))} navigate={navigate} />
    );
  }
  return (
    <Clan
      key={clan.clan_tag}
      me={me}
      clan={clan}
      search={find}
      show={
        search.show === "recruit" || search.show === "scout"
          ? search.show
          : null
      }
      fromRun={search.from === "run" && !policyActive(me)}
      navigate={navigate}
    />
  );
}

/** The old "You" pages: Away is said per clan now, under Members; Players
 *  lives with the account. */
export function YouPage() {
  const { me } = useSession();
  const navigate = useNav();
  const { sub } = useParams({ strict: false });
  const clan = me?.ok ? me.selected : null;
  const replace = sub !== "away";
  useEffect(() => {
    if (!me?.signed_in || me.unavailable) return;
    if (replace) window.location.replace(`${SETTINGS}/players`);
    else
      navigate(clan ? `${clanPath(clan.clan_tag)}/members/away` : CLAN, {
        replace: true,
      });
  }, [me, replace, clan, navigate]);
  return null;
}

export function RefusedPage() {
  const { me, checking, refresh } = useSession();
  const navigate = useNav();
  const { reason } = useParams({ strict: false });
  if (!me?.signed_in || me.unavailable) return null;
  return (
    <Refused
      reason={reason}
      me={me}
      checking={checking}
      onRecheck={async () => {
        const next = await refresh(true);
        if (next?.ok)
          navigate(next.selected ? landingPath(next) : CLAN, {
            replace: true,
          });
        else if (next?.reason) navigate(`${CLAN}/refused/${next.reason}`);
      }}
    />
  );
}

/** The notice after sign-in, while a player whose role is Elder or above is
 *  not verified: Elixir's verify notice, and Continue goes on as a member. */
export function VerifyPage() {
  const { me, setMe } = useSession();
  const navigate = useNav();
  const [busy, setBusy] = useState(false);
  if (!me?.ok || !me.verify_notice) return null;
  return (
    <>
      <VerifyPlayer titleAs="h1" />
      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api.acknowledgeVerify();
            setBusy(false);
            if (r.ok) {
              setMe(r.data);
              navigate(r.data.selected ? landingPath(r.data) : CLAN, {
                replace: true,
              });
            } else if (r.status === 401) {
              setMe({ signed_in: false, expired: true });
            }
          }}
        >
          {busy ? "Going on…" : "Continue"}
        </button>
      </div>
    </>
  );
}

/** Feedback is Elixir's one system (2026-10-08): a quiet button under the
 *  page opens the shared sheet, about this clan and the page it was on. */
export function SendFeedback({ me, path }) {
  const clan = me?.selected ?? null;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="clan-foot">
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => setOpen(true)}
        >
          Send feedback
        </button>
      </div>
      {open && (
        <FeedbackSheet
          area="clan"
          categories={FEEDBACK_CATEGORIES}
          about={
            clan
              ? `About Clan, in ${clan.name ?? clan.clan_tag}. The page you are on rides along.`
              : "About Clan. The page you are on rides along."
          }
          refs={clan ? [{ kind: "clan", ref: clan.clan_tag }] : []}
          context={{ page: pageOf(path) ?? "clan" }}
          send={feedbackApi.send}
          onClose={() => setOpen(false)}
          itemHref={feedbackItemHref}
          historyHref={FEEDBACK_HISTORY}
        />
      )}
    </>
  );
}

/** Pages any signed-in person reads, with a clan or none, before the
 *  notice after sign-in: the clan directory (#768) is for finding one. */
const OPEN_TO_ALL = new Set(["/directory"]);

/** Clan's pages inside the app's shell (apps/web App.jsx, ClanOutlet), which
 *  has already found the person signed in. */
export function ClanLayout() {
  const { pathname: path } = useLocation();
  // The path under the prefix: "/" is the landing, "/you" your page.
  const app = appPath(path) ?? "";
  const navigate = useNav();
  const queryClient = useQueryClient();
  const { me, checking, refresh, setMe } = useClanMe();
  // One selection at a time, held until the address is the new clan's.
  const { select, selecting } = useSelectClan({ navigate, setMe });

  // Where a signed-in person belongs, whatever address they arrived at.
  useEffect(() => {
    if (!me) return;
    // A link out of Clan (Settings, Home): the address changes before this
    // shell unmounts, and sending it back here would undo the click.
    if (path !== CLAN && !path.startsWith(`${CLAN}/`)) return;
    if (!me.signed_in) {
      // The session ended under Clan's read: the app reads its session
      // again, and its sign-in page follows.
      queryClient.invalidateQueries({ queryKey: ["me"], exact: true });
      return;
    }
    if (me.unavailable) return;
    const segment = app.split("/")[1];
    const searched = (tag) =>
      `${CLAN}/directory?q=${encodeURIComponent(tag.slice(1))}`;
    if (!me.ok) {
      // A clan's address, for someone Clan's gate turns away (no clan any
      // more, no player): the directory, searched for it, as a member of
      // another clan gets below. Its pages stay the gate's (Codex on #828).
      if (tagOf(segment)) {
        navigate(searched(tagOf(segment)), { replace: true });
        return;
      }
      if (
        !app.startsWith("/refused/") &&
        !app.startsWith("/you") &&
        !app.startsWith("/feedback") &&
        !OPEN_TO_ALL.has(app)
      )
        navigate(`${CLAN}/refused/${me.reason}`);
      return;
    }
    // The notice after sign-in comes first, once, until acknowledged; a
    // person's own pages and feedback stay open around it.
    const notice = me.verify_notice;
    if (notice && !notice.acknowledged) {
      if (
        app !== "/verify" &&
        !app.startsWith("/you") &&
        !app.startsWith("/feedback") &&
        !OPEN_TO_ALL.has(app)
      )
        navigate(`${CLAN}/verify`);
      return;
    }
    const atClan = clanFromPath(path, me.clans);
    // The landing is no page for a signed-in person with a clan: its Feed, or
    // the chooser at /clan when none is selected. A redirect, so it replaces
    // the address and Back never comes back to bounce.
    if (app === "/" || app === "/verify" || app.startsWith("/refused")) {
      if (me.selected) navigate(landingPath(me), { replace: true });
      else if (app !== "/") navigate(CLAN, { replace: true });
    } else if (isClanSegment(segment) && !atClan) {
      // A clan that is not theirs: the clan directory, searched for it, which
      // is open to anyone signed in (a link in mail lands here for a clan the
      // reader has left). Elixir has no page for a clan you are not in.
      navigate(tagOf(segment) ? searched(tagOf(segment)) : `${CLAN}/clans`, {
        replace: true,
      });
    } else if (
      atClan &&
      me.selected?.clan_tag !== atClan.clan_tag &&
      !selecting
    ) {
      // Arriving at another of your clans by URL selects it, so the
      // remembered clan follows where you actually went.
      // Email/action deep links select the clan without losing their destination.
      select(atClan.clan_tag, { keepPath: true });
    }
  }, [me, path, app, navigate, select, selecting, queryClient]);

  // The head and tabs belong to the clan being read.
  const inClan =
    Boolean(me?.signed_in && me.ok && me.selected) &&
    Boolean(parseClanPath(path));

  return (
    <SessionContext.Provider
      value={{ me, checking, refresh, setMe, select, selecting }}
    >
      <main className="page">
        <div className="page__inner page__inner--solo">
          {inClan ? (
            <ClanHead
              me={me}
              path={path}
              navigate={navigate}
              select={select}
              selecting={selecting}
            />
          ) : null}
          <RoleConfirming />
          <ErrorBoundary key={path}>
            {me?.signed_in === false ? (
              <div className="kit-skeleton" aria-busy="true" />
            ) : me?.unavailable ? (
              <Unavailable busy={checking} onRetry={() => refresh()} />
            ) : (
              <Outlet />
            )}
          </ErrorBoundary>
          {me?.signed_in && !me.unavailable ? (
            <SendFeedback me={me} path={path} />
          ) : null}
        </div>
      </main>
    </SessionContext.Provider>
  );
}
