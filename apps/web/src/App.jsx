import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { Landing } from "./views/Landing.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { Admin } from "./views/Admin.jsx";
import { Clan } from "./views/Clan.jsx";

export const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see " +
  "Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

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
          {authed && (
            <a
              href="/dashboard"
              onClick={(e) => {
                e.preventDefault();
                navigate("/dashboard");
              }}
            >
              Dashboard
            </a>
          )}
          {authed && (
            <a
              href="/clan"
              onClick={(e) => {
                e.preventDefault();
                navigate("/clan");
              }}
            >
              Clan
            </a>
          )}
          {authed && me.is_owner && (
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                navigate("/admin");
              }}
            >
              Admin
            </a>
          )}
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

      {path === "/signin" && (
        <SignIn
          onAuthed={async () => {
            await refresh();
            navigate("/dashboard");
          }}
        />
      )}
      {path === "/dashboard" && (
        <Dashboard me={me} refresh={refresh} navigate={navigate} />
      )}
      {path === "/clan" && <Clan me={me} navigate={navigate} />}
      {path === "/admin" && <Admin me={me} />}
      {path !== "/signin" &&
        path !== "/dashboard" &&
        path !== "/clan" &&
        path !== "/admin" && <Landing authed={authed} navigate={navigate} />}

      <footer>{DISCLAIMER}</footer>
    </main>
  );
}
