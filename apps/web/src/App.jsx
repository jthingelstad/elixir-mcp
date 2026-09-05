import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { Landing } from "./views/Landing.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { Admin } from "./views/Admin.jsx";
import { Docs } from "./views/Docs.jsx";
import { Explore } from "./views/Explore.jsx";
import { Clan } from "./views/Clan.jsx";
import { Collections } from "./views/Collections.jsx";
import { Collectors } from "./views/Collectors.jsx";

export const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see " +
  "Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

/**
 * Two-tier navigation (Jamie, 2026-09-05): tier 1 = stable product areas
 * (Explore the data / your Account / Docs / Admin ops); tier 2 = the
 * pages within, where growth lands. Old flat paths redirect.
 */
const SECTIONS = {
  explore: {
    label: "Explore",
    authed: true,
    pages: [
      { slug: "player", label: "Player" },
      { slug: "clan", label: "Clan & War" },
      { slug: "collections", label: "Collections" },
      { slug: "collectors", label: "Collectors" },
    ],
  },
  account: {
    label: "Account",
    authed: true,
    pages: [
      { slug: "overview", label: "Overview" },
      { slug: "agents", label: "Agents" },
      { slug: "usage", label: "Usage" },
      { slug: "feedback", label: "Feedback" },
    ],
  },
  docs: { label: "Docs", authed: false, pages: [] }, // Docs owns its own ToC (URL-addressable: /docs/<page>)
  admin: {
    label: "Admin",
    authed: true,
    ownerOnly: true,
    pages: [
      { slug: "requests", label: "Requests" },
      { slug: "accounts", label: "Accounts" },
      { slug: "collections", label: "Collections" },
      { slug: "gateways", label: "Collectors", ownerOnly: true },
      { slug: "tokens", label: "Tokens", ownerOnly: true },
      { slug: "feedback", label: "Feedback" },
      { slug: "usage", label: "Usage" },
    ],
  },
};

const REDIRECTS = {
  "/dashboard": "/account/overview",
  "/clan": "/explore/clan",
  "/explore": "/explore/player",
  "/account": "/account/overview",
  "/admin": "/admin/requests",
};

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
  const effectivePath = REDIRECTS[path] ?? path;
  const [, section, page] = effectivePath.split("/");
  const sec = SECTIONS[section];
  const activePage = sec?.pages.find((p) => p.slug === page)?.slug;

  const link = (to, label, key, isActive) => (
    <a
      key={key ?? to}
      href={to}
      className={
        (isActive ?? effectivePath.startsWith(to)) ? "active" : undefined
      }
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );

  return (
    <main>
      <header className="site">
        <h1>
          <a
            href="/"
            style={{ color: "inherit", textDecoration: "none" }}
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            Elixir MCP
          </a>
        </h1>
        <nav>
          {authed &&
            link(
              "/explore/player",
              "Explore",
              "explore",
              section === "explore",
            )}
          {authed &&
            link(
              "/account/overview",
              "Account",
              "account",
              section === "account",
            )}
          {link("/docs", "Docs", "docs", section === "docs")}
          {authed &&
            me.is_admin &&
            link("/admin/requests", "Admin", "admin", section === "admin")}
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
        </nav>
      </header>

      {sec && sec.pages.length > 0 && (
        <nav className="subnav" aria-label={`${sec.label} pages`}>
          {sec.pages
            .filter((p) => !p.ownerOnly || me?.is_owner)
            .map((p) =>
              link(`/${section}/${p.slug}`, p.label, `${section}-${p.slug}`),
            )}
        </nav>
      )}

      {effectivePath === "/signin" && (
        <SignIn
          onAuthed={async () => {
            await refresh();
            navigate("/account/overview");
          }}
        />
      )}
      {section === "docs" && <Docs page={page} navigate={navigate} />}
      {section === "explore" && activePage === "player" && (
        <Explore me={me} navigate={navigate} />
      )}
      {section === "explore" && activePage === "clan" && (
        <Clan me={me} navigate={navigate} />
      )}
      {section === "explore" && activePage === "collections" && (
        <Collections me={me} navigate={navigate} />
      )}
      {section === "explore" && activePage === "collectors" && <Collectors />}
      {section === "account" && (
        <Dashboard
          me={me}
          refresh={refresh}
          navigate={navigate}
          page={activePage ?? "overview"}
        />
      )}
      {section === "admin" && <Admin me={me} page={activePage ?? "requests"} />}
      {effectivePath !== "/signin" &&
        !["docs", "explore", "account", "admin"].includes(section) && (
          <Landing authed={authed} navigate={navigate} />
        )}

      <footer>{DISCLAIMER}</footer>
    </main>
  );
}
