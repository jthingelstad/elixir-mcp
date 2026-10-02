import { sessionGeneration } from "@elixir-mcp/client";
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  Chrome as ChromeBar,
  FAMILY_PRODUCTS,
  Disclaimer,
  ErrorBoundary,
  Icon,
  Rail as RailList,
  RailIdentity,
} from "@elixir-mcp/ui";
import { api } from "./api.js";
import { keys, useMeQuery } from "./lib/queries.js";
import { railItems, railKey } from "./lib/rail.js";
import { CLAN, appPath, clanPath, isClanSegment, tagOf } from "./lib/base.js";
import { RoleChip } from "./components/RoleChip.jsx";
import { Clan } from "./views/Clan.jsx";
import { Clans } from "./views/Clans.jsx";
import { Manage } from "./views/Manage.jsx";
import { Standing } from "./views/Standing.jsx";
import { Landing } from "./views/Landing.jsx";
import { Refused } from "./views/Refused.jsx";
import { You } from "./views/You.jsx";
import { Away } from "./views/Away.jsx";
import { Recruit } from "./views/Recruit.jsx";
import { Trophies } from "./views/Trophies.jsx";
import { ActionDetail, Actions } from "./views/Actions.jsx";
import { YouHere } from "./views/YouHere.jsx";
import { Week } from "./views/Week.jsx";
import { VerifyNotice } from "./views/VerifyNotice.jsx";
import { ELIXIR_LINKS } from "./lib/links.js";
import {
  rememberNext,
  tabStore,
  takeNext,
  useAutoSignIn,
} from "./lib/auto-signin.js";

// The clan map brings Leaflet and the place lists: loaded when opened.
const ClanMap = lazy(() =>
  import("./views/ClanMap.jsx").then((m) => ({ default: m.ClanMap })),
);
import { Feedback, FeedbackItem } from "./views/Feedback.jsx";
import { MaintainItem, MaintainQueue } from "./views/Maintain.jsx";

/**
 * Routes, all under Elixir's /clan (CLAN, lib/base.js): `/clan` (landing,
 * signed out), `/clan/clans` (the chooser), `/clan/<TAG>` (a clan page;
 * the tag without its #) with its sections and Manage tabs, `/clan/you`
 * and `/clan/you/away`, `/clan/verify` (the notice after sign-in),
 * `/clan/refused/<reason>`, `/clan/feedback[/<id>]`,
 * `/clan/maintain/feedback[/<id>]`. The app's own pages win over a tag.
 * The router owns history and params; the GATE - where a signed-in
 * person belongs, whatever address they arrived at - is the Shell's
 * effect below, because it is a session state machine (a refresh, a
 * select) and not a per-route loader.
 */

/** `/clan/<TAG>[/<section>[/<tab>]]` parsed: the tag with its #, the
 *  section (roster by default) and the Manage tab or, under actions, the
 *  action's number (`/clan/<TAG>/actions/37`). */
export function parseClanPath(path) {
  const m =
    /^\/([^/]+)(?:\/(manage|me|week|actions|standing|trophies|recruit|map)(?:\/([a-z0-9-]+))?)?\/?$/.exec(
      appPath(path) ?? "",
    );
  const tag = m ? tagOf(m[1]) : null;
  if (!tag) return null;
  return { tag, section: m[2] ?? "roster", tab: m[3] ?? null };
}

/** The clan a `/clan/<TAG>...` path names, if it is one of the person's. */
export function clanFromPath(path, clans = []) {
  const parsed = parseClanPath(path);
  if (!parsed) return null;
  return clans.find((c) => c.clan_tag === parsed.tag) ?? null;
}

/** `navigate(to)` for the views: a path, with a query string riding
 *  along (`/clan?error=session_expired`). */
function useNav() {
  const nav = useNavigate();
  return useCallback(
    (to) => {
      const [pathname, qs] = String(to).split("?");
      return nav({
        to: pathname,
        search: qs ? Object.fromEntries(new URLSearchParams(qs)) : {},
      });
    },
    [nav],
  );
}

/** Elixir's breakpoint: below it the rail is a disclosure above the page. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.("(max-width: 900px)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq?.addEventListener) return undefined;
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** The session, as a query on ["me"]. A 401 reads as signed out (with
 *  whether it expired), a transport failure or a 5xx as "unavailable"
 *  - signed in, Elixir did not answer - and never as signed out.
 *  `refresh(true)` is the server-side re-read (?refresh=1). */
function useMe() {
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
/** The session and the clan chooser, for the pages. */
const useSession = () => useContext(SessionContext);

export function LandingPage() {
  const { me, sharedSession } = useSession();
  const search = window.location.search;
  const error = new URLSearchParams(search).get("error");
  // Signed in to Elixir already? Then Clan's sign-in starts by itself
  // (lib/auto-signin.js) and the landing is only a line while it goes.
  const auto = useAutoSignIn(
    Boolean(!sharedSession && me && !me.signed_in),
    search,
  );
  if (me === null || me.signed_in) return null;
  if (!sharedSession && auto !== "landing")
    return <p className="page__lede">Signing you in with Elixir…</p>;
  return <Landing error={error} sharedSession={sharedSession} />;
}

export function ClansPage() {
  const { me, select, selecting } = useSession();
  if (!me?.ok) return null;
  return <Clans me={me} onSelect={select} selecting={selecting} />;
}

export function ClanPage() {
  const { me } = useSession();
  const navigate = useNav();
  const { pathname } = useLocation();
  const parsed = parseClanPath(pathname);
  if (!me?.ok || !parsed) return null;
  const clan = clanFromPath(pathname, me.clans);
  if (!clan) return null;
  const who = {
    player_tag: clan.acting_as,
    name: clan.acting_as_name,
    role: clan.role,
  };
  if (parsed.section === "me")
    return <YouHere key={clan.clan_tag} clan={clan} navigate={navigate} />;
  // The week in the clan: the latest closed week, or one by its id.
  if (parsed.section === "week")
    return (
      <Week
        key={`${clan.clan_tag}-${parsed.tab ?? "latest"}`}
        clan={clan}
        week={parsed.tab ? parsed.tab.toUpperCase() : null}
        navigate={navigate}
      />
    );
  // One action, by its number: the address people send each other.
  if (parsed.section === "actions" && /^[0-9]{1,7}$/.test(parsed.tab ?? ""))
    return (
      <ActionDetail
        key={`${clan.clan_tag}-${parsed.tab}`}
        clan={clan}
        who={who}
        number={Number(parsed.tab)}
        navigate={navigate}
      />
    );
  // Actions are everyone's; the leaders' old Inbox address lands here.
  if (
    parsed.section === "actions" ||
    (parsed.section === "manage" && (parsed.tab ?? "inbox") === "inbox")
  )
    return (
      <Actions key={clan.clan_tag} clan={clan} who={who} navigate={navigate} />
    );
  if (parsed.section === "manage")
    return (
      <Manage
        key={clan.clan_tag}
        clan={clan}
        tab={parsed.tab ?? "inbox"}
        navigate={navigate}
        who={who}
      />
    );
  if (parsed.section === "standing")
    return (
      <Standing key={clan.clan_tag} clan={clan} who={who} navigate={navigate} />
    );
  if (parsed.section === "trophies")
    return <Trophies key={clan.clan_tag} clan={clan} who={who} />;
  if (parsed.section === "recruit")
    return <Recruit key={clan.clan_tag} clan={clan} navigate={navigate} />;
  if (parsed.section === "map")
    return (
      <Suspense fallback={<p className="page__lede">Reading…</p>}>
        <ClanMap key={clan.clan_tag} clan={clan} />
      </Suspense>
    );
  return <Clan key={clan.clan_tag} me={me} clan={clan} navigate={navigate} />;
}

export function YouPage() {
  const { me } = useSession();
  const { sub } = useParams({ strict: false });
  if (!me?.signed_in || me.unavailable) return null;
  return sub === "away" ? <Away me={me} /> : <You me={me} />;
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
          navigate(
            next.selected ? clanPath(next.selected.clan_tag) : `${CLAN}/clans`,
          );
        else if (next?.reason) navigate(`${CLAN}/refused/${next.reason}`);
      }}
    />
  );
}

/** The notice after sign-in: an unverified player's Elder, Co-leader or
 *  Leader role waits for Elixir → Verify. "I understand" goes on. */
export function VerifyPage() {
  const { me, setMe } = useSession();
  const navigate = useNav();
  if (!me?.ok || !me.verify_notice) return null;
  return (
    <VerifyNotice
      me={me}
      onAcknowledge={async () => {
        const r = await api.acknowledgeVerify();
        if (r.ok) {
          setMe(r.data);
          navigate(
            r.data.selected
              ? clanPath(r.data.selected.clan_tag)
              : `${CLAN}/clans`,
          );
        } else if (r.status === 401) {
          setMe({ signed_in: false, expired: true });
        }
      }}
    />
  );
}

export function FeedbackPage() {
  const { me } = useSession();
  const navigate = useNav();
  const { id } = useParams({ strict: false });
  if (!me?.signed_in || me.unavailable) return null;
  return id ? (
    <FeedbackItem id={id} navigate={navigate} />
  ) : (
    <Feedback me={me} navigate={navigate} />
  );
}

export function MaintainPage() {
  const { me } = useSession();
  const navigate = useNav();
  const { id } = useParams({ strict: false });
  if (!me?.signed_in || me.unavailable) return null;
  return id ? (
    <MaintainItem id={id} navigate={navigate} />
  ) : (
    <MaintainQueue navigate={navigate} />
  );
}

/**
 * The top bar: the family's, exactly as elixir.poapkings.com draws it -
 * the logo and "Elixir" home to Elixir's front page (this origin's
 * root), the places with Clan lit green because this is Clan, routed
 * in-app, then Docs and Play Drop.
 *
 * The bar's shape never varies by session: its account slot is one
 * width, and Clan fills it from Clan's own session (`me`, from
 * /api/clan/me), never Elixir's. Empty while Clan asks; "Sign in",
 * leading to Clan's landing, signed out; signed in, the player you act
 * as (the star), your page, and Clan's own sign-out, a form post.
 */
const PRODUCTS = FAMILY_PRODUCTS.map((p) =>
  p.key === "clan" ? { ...p, href: CLAN } : p,
);

/** The account slot from Clan's session: undefined while unknown, null
 *  signed out, the person signed in. */
export function clanAccount(me) {
  if (!me || me.unavailable) return undefined;
  if (!me.signed_in) return null;
  const clan = me.selected ?? null;
  return {
    name: clan?.player_name ?? me.primary?.name ?? "Signed in",
    detail: clan
      ? `${clan.role_label ?? clan.role} · ${clan.name}`
      : "with Elixir",
    links: [
      {
        key: "you",
        icon: "user-round",
        label: "You",
        hint: "what Clan read from Elixir",
        href: `${CLAN}/you`,
      },
      {
        key: "feedback",
        icon: "message-square",
        label: "Feedback",
        href: `${CLAN}/feedback`,
      },
    ],
    signOut: {
      label: "Sign out",
      note: "Ends this browser's Clan session. The Console keeps its own sign-in.",
      action: "/api/clan/auth/logout",
    },
  };
}

function Chrome({ navigate, me }) {
  const inApp = (to) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    navigate(to);
  };
  const products = PRODUCTS.map((p) =>
    p.key === "clan" ? { ...p, onClick: inApp(CLAN) } : p,
  );
  return (
    <ChromeBar
      home="/"
      products={products}
      current="clan"
      account={clanAccount(me)}
      signIn={{ label: "Sign in", href: CLAN, onClick: inApp(CLAN) }}
    />
  );
}

/** The left rail: Elixir's console structure carried over (Jamie,
 *  2026-09-12: "that is where we are going"). The kit's Rail, fed what
 *  this person may see (lib/rail.js) and the clan they are in. */
export function Rail({ me, path, navigate, narrow, sharedSession = false }) {
  const clan = me?.selected ?? null;
  return (
    <RailList
      label="Sections"
      items={railItems(me)}
      current={railKey(path)}
      navigate={navigate}
      narrow={narrow}
      title={clan?.name ?? "Elixir Clan"}
      aside={clan?.clan_tag}
      subtitle={clan?.name ?? ""}
      identity={
        <RailIdentity
          href={`${CLAN}/you`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${CLAN}/you`);
          }}
          name={
            <>
              <span className="yours">★</span>{" "}
              {clan?.player_name ?? me?.primary?.name ?? "Signed in"}
            </>
          }
          detail={
            clan ? (
              <>
                <RoleChip role={clan.role} label={clan.role_label} />
                {clan.verified === false ? (
                  <span className="chip chip--warn">unverified</span>
                ) : null}
              </>
            ) : (
              "with Elixir"
            )
          }
          action={
            sharedSession ? null : (
              // Signing out is a form post, as it always was here: an
              // action with no destination of its own.
              <form method="post" action="/api/clan/auth/logout">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="btn btn--sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name="log-out" size={16} />
                </button>
              </form>
            )
          }
        />
      }
    />
  );
}

/** Whether this sign-in may record what the person does in Elixir
 *  (`clans:attest`, asked for since 2026-09-25). A session from before
 *  holds `cr:read` alone: what it completes is logged as not shared, so
 *  every page asks the person to sign in again. */
export const canShare = (me) =>
  String(me?.scope ?? "")
    .split(/\s+/)
    .includes("clans:attest");

export function ClanShell({
  sharedSession = false,
  SharedChrome = null,
  rememberAfterSignIn = () => {},
}) {
  const { pathname: path } = useLocation();
  // The path under the prefix: "/" is the landing, "/you" your page.
  const app = appPath(path) ?? "";
  const navigate = useNav();
  const narrow = useNarrow();
  const { me, checking, refresh, setMe } = useMe();
  const [selecting, setSelecting] = useState(false);

  const select = useCallback(
    async (tag) => {
      setSelecting(true);
      const r = await api.select(tag);
      setSelecting(false);
      if (r.ok) {
        setMe(r.data);
        navigate(clanPath(tag));
      } else if (r.status === 401) {
        setMe({ signed_in: false, expired: true });
      }
    },
    [navigate, setMe],
  );

  // Where a signed-in person belongs, whatever address they arrived at.
  useEffect(() => {
    if (!me) return;
    if (!me.signed_in) {
      if (sharedSession) {
        rememberAfterSignIn(path + window.location.search);
        return;
      }
      if (app !== "/") {
        // The address they opened (an email's link to Actions, say) is
        // where they land once signed in.
        rememberNext(tabStore(), path, Date.now());
        navigate(me.expired ? `${CLAN}?error=session_expired` : CLAN);
      }
      return;
    }
    if (me.unavailable) return;
    if (!me.ok) {
      if (
        !app.startsWith("/refused/") &&
        !app.startsWith("/you") &&
        !app.startsWith("/feedback")
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
        !app.startsWith("/feedback")
      )
        navigate(`${CLAN}/verify`);
      return;
    }
    // Signed in from a Clan address opened while signed out: there.
    const next = takeNext(tabStore(), Date.now());
    if (next && next !== path) {
      navigate(next);
      return;
    }
    const atClan = clanFromPath(path, me.clans);
    // The landing is no page for a signed-in person: their clan, or the
    // chooser when none is selected.
    if (app === "/" || app === "/verify" || app.startsWith("/refused")) {
      navigate(me.selected ? clanPath(me.selected.clan_tag) : `${CLAN}/clans`);
    } else if (isClanSegment(app.split("/")[1]) && !atClan) {
      navigate(`${CLAN}/clans`);
    } else if (
      atClan &&
      me.selected?.clan_tag !== atClan.clan_tag &&
      !selecting
    ) {
      // Arriving at another of your clans by URL selects it, so the
      // remembered clan follows where you actually went.
      select(atClan.clan_tag);
    }
  }, [
    me,
    path,
    app,
    navigate,
    select,
    selecting,
    sharedSession,
    rememberAfterSignIn,
  ]);

  // The rail belongs to a signed-in person with somewhere to go: their
  // clan pages, or their own pages while the gate still refuses them.
  const showRail =
    Boolean(me?.signed_in) &&
    !me.unavailable &&
    (me.ok || app.startsWith("/you") || app.startsWith("/feedback"));

  return (
    <SessionContext.Provider
      value={{ me, checking, refresh, setMe, select, selecting, sharedSession }}
    >
      <div className="shell">
        {SharedChrome ? (
          <SharedChrome navigate={navigate} />
        ) : (
          <Chrome navigate={navigate} me={me} />
        )}
        <div
          className={`mx-auto flex w-full max-w-page flex-auto items-stretch ${narrow ? "flex-col" : "flex-row"}`}
        >
          {showRail ? (
            <Rail
              me={me}
              path={path}
              navigate={navigate}
              narrow={narrow}
              sharedSession={sharedSession}
            />
          ) : null}
          <main className="page">
            <div
              className={`page__inner${showRail ? "" : " page__inner--solo max-w-page"}`}
            >
              {!sharedSession && me?.signed_in && me.ok && !canShare(me) ? (
                <div className="callout callout--warn mb-4" role="status">
                  <span>
                    Sign in again so what you do here reaches Elixir. This
                    sign-in is from before Elixir Clan could record departures,
                    promotions, awards and aways in Elixir, so what you complete
                    now stays here.
                  </span>
                  <form method="post" action="/api/clan/auth/logout">
                    <button type="submit" className="btn btn--sm">
                      Sign out, then sign in again
                    </button>
                  </form>
                </div>
              ) : null}
              {me?.signed_in &&
              me.ok &&
              (me.selected?.verified === false || me.selected?.unlock) &&
              parseClanPath(path) ? (
                <div className="callout callout--info mb-4" role="status">
                  <span>
                    {me.selected.unlock
                      ? `In the game ${me.selected.unlock.name ?? me.selected.unlock.player_tag} is ${me.selected.unlock.role_label === "Elder" ? "an" : "a"} ${me.selected.unlock.role_label}. Verify that player in Elixir to use those tools here; until then you are here as a member.`
                      : "Your player is not verified in Elixir, so you are here as a member who reads: verify it to mark yourself away, comment or join the clan map."}
                  </span>
                  <a className="btn btn--sm" href={ELIXIR_LINKS.verify}>
                    Verify in Elixir ›
                  </a>
                </div>
              ) : null}
              <ErrorBoundary key={path}>
                {sharedSession && me && !me.signed_in && app !== "/" ? (
                  <Landing
                    error={me.expired ? "session_expired" : null}
                    sharedSession
                  />
                ) : null}
                {me?.signed_in && me.unavailable ? (
                  <div
                    className="callout callout--warn mx-auto mt-10 max-w-[560px]"
                    role="alert"
                  >
                    <span>
                      Elixir did not answer. Your sign-in is fine; try again in
                      a minute.
                    </span>
                  </div>
                ) : (
                  <Outlet />
                )}
              </ErrorBoundary>
            </div>
          </main>
        </div>
        <Disclaimer />
      </div>
    </SessionContext.Provider>
  );
}
