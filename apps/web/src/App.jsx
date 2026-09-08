import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { SignIn } from "./views/SignIn.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { Admin } from "./views/Admin.jsx";
import { Data } from "./views/Data.jsx";
import { Explore } from "./views/Explore.jsx";

/**
 * Shell + three-tier navigation (design handoff 2026-09-05): tier 1 is
 * a gold underline, tier 2 a purple underline, in-page tabs a segmented
 * well — three tiers, three shapes. Explore has no tier-2 row: it is a
 * lookup plus addressable records (the trail replaces the page row).
 *
 * This app is the site's DYNAMIC half (2026-09-07 split). Home, docs,
 * updates and the contract changelog are real pages built by apps/site
 * and served from the same hostname; they are reached with plain hrefs
 * (STATIC_LINKS below), which are full page loads on purpose. Anything
 * the app does not recognise leaves for the static home rather than
 * rendering an empty main.
 */

/** Paths owned by the static site. The edge router in infra/template.yaml
 *  holds the same list; a test pins the two together, because a path in
 *  one and not the other is either a dead link or an app shell served
 *  where a document was expected. */
export const STATIC_LINKS = {
  home: "/",
  docs: "/docs",
  updates: "/updates",
  changelog: "/data/changelog",
};
export const SECTIONS = {
  data: {
    label: "Data",
    authed: false,
    pages: [
      { slug: "dashboard", label: "Dashboard" },
      { slug: "status", label: "Status" },
      // Changelog is a static page; the tier-2 row links out to it.
      { slug: "changelog", label: "Changelog", static: true },
    ],
  },
  explore: { label: "Explore", authed: true, pages: [] },
  account: {
    label: "Account",
    authed: true,
    pages: [
      { slug: "overview", label: "Overview" },
      { slug: "agents", label: "Agents" },
      { slug: "connections", label: "Connections" },
      { slug: "activity", label: "Activity" },
      { slug: "usage", label: "Usage" },
      { slug: "collector", label: "Collector" },
      { slug: "feedback", label: "Feedback" },
    ],
  },
  admin: {
    label: "Admin",
    authed: true,
    adminOnly: true,
    pages: [
      { slug: "requests", label: "Requests" },
      { slug: "accounts", label: "Accounts" },
      { slug: "collections", label: "Collections" },
      { slug: "feedback", label: "Feedback" },
      { slug: "usage", label: "Usage" },
      { slug: "gateways", label: "Collectors", ownerOnly: true },
      { slug: "tokens", label: "Tokens", ownerOnly: true },
    ],
  },
};

const REDIRECTS = {
  "/dashboard": "/account/overview",
  "/clan": "/explore",
  "/account": "/account/overview",
  "/admin": "/admin/requests",
  "/data": "/data/dashboard",
  "/explore/player": "/explore",
  "/explore/clan": "/explore",
  "/explore/meta": "/explore",
  "/explore/collections": "/explore",
  "/explore/collectors": "/account/collector",
};

/** Guard restored/bookmarked routes: a stale path to a removed section
 *  must fall back to a known-good route, never an empty main. Anything
 *  this app no longer owns returns null, and the caller leaves for the
 *  static home with a real navigation. */
export function legalRoute(path) {
  const [, section, page] = path.split("/");
  if (path === "/signin") return path;
  const sec = SECTIONS[section];
  if (!sec) return null;
  if (section === "explore") return path; // records are addressable
  // A static page can sit inside an app section (Data > Changelog). It
  // belongs to the other half, so hand it back rather than quietly
  // substituting the section's default page.
  if (sec.pages.some((p) => p.slug === page && p.static)) return null;
  const appPages = sec.pages.filter((p) => !p.static);
  if (appPages.length === 0) return `/${section}`;
  if (appPages.some((p) => p.slug === page)) return path;
  return `/${section}/${appPages[0].slug}`;
}

/** Tab titles. The distinguishing word goes FIRST, because a browser
 *  tab truncates from the right - "Elixir MCP - Status" is useless at
 *  tab width, "Status - Elixir MCP" is not. Sections that own their own
 *  sub-pages (explore records, docs) name the record instead. */
const SITE = "Elixir MCP";
const prettify = (seg) =>
  /^[#%]/.test(seg)
    ? decodeURIComponent(seg)
    : decodeURIComponent(seg)
        .replace(/-/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

export function titleFor(section, sec, path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return SITE;
  if (!sec) return SITE;
  const pageSlug = parts[1];
  const known = sec.pages?.find((p) => p.slug === pageSlug)?.label;
  // A record deeper than the page slug is the most specific thing on
  // screen, so it wins the front of the title.
  const record = parts[2] ? prettify(parts[2]) : null;
  const lead = record ?? known ?? (pageSlug ? prettify(pageSlug) : null);
  if (!lead || lead === sec.label) return `${sec.label} - ${SITE}`;
  return `${lead} - ${sec.label} - ${SITE}`;
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to) => {
    window.history.pushState({}, "", to);
    setPath(to);
  }, []);
  return { path, navigate };
}

function Disclaimer() {
  return (
    <footer className="disclaimer">
      <span className="disclaimer__tag">UNOFFICIAL</span>
      <span className="disclaimer__text">
        This material is unofficial and is not endorsed by Supercell. For more
        information see Supercell&rsquo;s Fan Content Policy:{" "}
        <a href="https://www.supercell.com/fan-content-policy">
          www.supercell.com/fan-content-policy
        </a>
        .
      </span>
      <span className="disclaimer__family">a POAP KINGS product</span>
    </footer>
  );
}

function SignInWall({ navigate }) {
  return (
    <div className="panel" style={{ maxWidth: "420px", margin: "48px auto 0" }}>
      <div className="panel__body" style={{ textAlign: "center" }}>
        <h1 className="page-title" style={{ marginBottom: "8px" }}>
          Sign in first
        </h1>
        <p style={{ color: "var(--faint)", fontSize: "13px" }}>
          This part of Elixir MCP shows your recorded history. Sign in with the
          email on your access request.
        </p>
        <button
          className="btn"
          onClick={() => navigate("/signin")}
          style={{ marginTop: "8px" }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { path, navigate } = useRoute();
  const [me, setMe] = useState(null); // null = loading

  const refresh = useCallback(async () => {
    const { data } = await api.me();
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const authed = me?.authenticated === true;
  const owned = legalRoute(REDIRECTS[path] ?? path);

  // A path this app does not own belongs to the static site. Replace
  // the entry so Back does not bounce between the two halves.
  useEffect(() => {
    if (owned === null) window.location.replace(STATIC_LINKS.home);
  }, [owned]);

  const effectivePath = owned ?? "/account/overview";
  const [, section, page] = effectivePath.split("/");
  const sec = SECTIONS[section];
  const activePage = sec?.pages.find((p) => p.slug === page)?.slug;

  useEffect(() => {
    document.title = titleFor(section, sec, effectivePath);
  }, [section, sec, effectivePath]);
  const tier2Pages = (sec?.pages ?? []).filter(
    (p) => !p.ownerOnly || me?.is_owner,
  );

  const t1 = (to, label, key, active) => (
    <a
      key={key}
      href={to}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );

  const needsAuth = sec?.authed && !authed && me !== null;

  return (
    <div className="shell">
      <header className="nav1">
        <div className="nav1__inner wrap">
          <a className="wordmark" href="/" style={{ padding: "14px 0" }}>
            Elixir MCP
          </a>
          <nav>
            {/* Plain anchors: these paths are static documents. */}
            <a href={STATIC_LINKS.home}>Home</a>
            {t1("/data/dashboard", "Data", "data", section === "data")}
            {authed &&
              t1("/explore", "Explore", "explore", section === "explore")}
            {authed &&
              t1(
                "/account/overview",
                "Account",
                "account",
                section === "account",
              )}
            <a href={STATIC_LINKS.docs}>Docs</a>
            {/* Updates was missing here entirely, so the nav lost an item the
                moment you crossed from the static half into the app. One site
                should not change shape as you walk through it. */}
            <a href={STATIC_LINKS.updates}>Updates</a>
            {authed &&
              me.is_admin &&
              t1("/admin/requests", "Admin", "admin", section === "admin")}
          </nav>
          <div className="nav1__meta">
            {authed ? (
              <a
                href="/signout"
                onClick={async (e) => {
                  e.preventDefault();
                  await api.signOut();
                  window.location.assign(STATIC_LINKS.home);
                }}
              >
                Sign out
              </a>
            ) : (
              <a
                href="/signin"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/signin");
                }}
              >
                Sign in
              </a>
            )}
          </div>
        </div>
      </header>

      {tier2Pages.length > 0 && !needsAuth && (
        <nav className="nav2" aria-label={`${sec.label} pages`}>
          <div className="nav2__inner wrap">
            {tier2Pages.map((p) =>
              p.static ? (
                <a key={p.slug} href={`/${section}/${p.slug}`}>
                  {p.label}
                </a>
              ) : (
                <a
                  key={p.slug}
                  href={`/${section}/${p.slug}`}
                  aria-current={activePage === p.slug ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/${section}/${p.slug}`);
                  }}
                >
                  {p.label}
                </a>
              ),
            )}
          </div>
        </nav>
      )}

      <main className="wrap">
        {owned === null ? null : effectivePath === "/signin" ? (
          <SignIn
            onAuthed={async () => {
              await refresh();
              navigate("/account/overview");
            }}
          />
        ) : needsAuth ? (
          <SignInWall navigate={navigate} />
        ) : section === "data" ? (
          <Data page={activePage ?? "dashboard"} />
        ) : section === "explore" ? (
          <Explore me={me} navigate={navigate} path={effectivePath} />
        ) : section === "account" ? (
          <Dashboard
            me={me}
            refresh={refresh}
            navigate={navigate}
            page={activePage ?? "overview"}
            itemId={effectivePath.split("/")[3]}
          />
        ) : section === "admin" ? (
          me?.is_admin ? (
            <Admin
              me={me}
              page={activePage ?? "requests"}
              navigate={navigate}
              itemId={effectivePath.split("/")[3]}
            />
          ) : (
            <SignInWall navigate={navigate} />
          )
        ) : null}
      </main>

      <Disclaimer />
    </div>
  );
}
