import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { Landing } from "./views/Landing.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { Admin } from "./views/Admin.jsx";
import { Docs } from "./views/Docs.jsx";
import { Data } from "./views/Data.jsx";
import { Explore } from "./views/Explore.jsx";

/**
 * Shell + three-tier navigation (design handoff 2026-09-05): tier 1 is
 * a gold underline, tier 2 a purple underline, in-page tabs a segmented
 * well — three tiers, three shapes. Explore has no tier-2 row: it is a
 * lookup plus addressable records (the trail replaces the page row).
 */
const SECTIONS = {
  home: { label: "Home", authed: false, pages: [] },
  data: {
    label: "Data",
    authed: false,
    pages: [
      { slug: "dashboard", label: "Dashboard" },
      { slug: "status", label: "Status" },
      { slug: "changelog", label: "Changelog" },
    ],
  },
  explore: { label: "Explore", authed: true, pages: [] },
  account: {
    label: "Account",
    authed: true,
    pages: [
      { slug: "overview", label: "Overview" },
      { slug: "agents", label: "Agents" },
      { slug: "activity", label: "Activity" },
      { slug: "usage", label: "Usage" },
      { slug: "collector", label: "Collector" },
      { slug: "feedback", label: "Feedback" },
    ],
  },
  docs: { label: "Docs", authed: false, pages: [] },
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
 *  must fall back to a known-good route, never an empty main. */
function legalRoute(path) {
  const [, section, page] = path.split("/");
  if (path === "/" || path === "" || path === "/signin") return path;
  const sec = SECTIONS[section];
  if (!sec) return "/";
  if (section === "explore") return path; // records are addressable
  if (section === "docs") return path; // docs own their pages
  if (sec.pages.length === 0) return `/${section}`;
  if (sec.pages.some((p) => p.slug === page)) return path;
  return `/${section}/${sec.pages[0].slug}`;
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
  const effectivePath = legalRoute(REDIRECTS[path] ?? path);
  const [, sectionRaw, page] = effectivePath.split("/");
  const section = effectivePath === "/" ? "home" : sectionRaw;
  const sec = SECTIONS[section];
  const activePage = sec?.pages.find((p) => p.slug === page)?.slug;
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
          <a
            className="wordmark"
            href="/"
            style={{ padding: "14px 0" }}
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            Elixir MCP
          </a>
          <nav>
            {t1("/", "Home", "home", section === "home")}
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
            {t1("/docs", "Docs", "docs", section === "docs")}
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
                  await refresh();
                  navigate("/");
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
            {tier2Pages.map((p) => (
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
            ))}
          </div>
        </nav>
      )}

      <main className="wrap">
        {effectivePath === "/signin" ? (
          <SignIn
            onAuthed={async () => {
              await refresh();
              navigate("/account/overview");
            }}
          />
        ) : needsAuth ? (
          <SignInWall navigate={navigate} />
        ) : section === "home" ? (
          <Landing authed={authed} navigate={navigate} />
        ) : section === "data" ? (
          <Data page={activePage ?? "dashboard"} />
        ) : section === "docs" ? (
          <Docs page={page} navigate={navigate} />
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
        ) : (
          <Landing authed={authed} navigate={navigate} />
        )}
      </main>

      <Disclaimer />
    </div>
  );
}
