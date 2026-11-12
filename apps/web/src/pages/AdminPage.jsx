import { useLocation } from "@tanstack/react-router";
import { Admin } from "../views/Admin.jsx";
import { SignInWall, StaffOnly, useMe, useNav } from "../App.jsx";
import { settingsHere } from "../lib/settings.js";

/** The route's page: the address says which Admin page (lib/settings.js). */
export function AdminRoutePage() {
  const { pathname } = useLocation();
  const here = settingsHere(pathname);
  return <AdminPage page={here?.admin} itemId={here?.id} />;
}

/** /settings/admin/{page}/{itemId}: admins only (under /console/admin until
 *  2026-11-12). Signed in without the role is its own state, never "Sign in
 *  first". The client only hides it: every read behind it is the server's to
 *  refuse. */
function AdminPage({ page, itemId }) {
  const navigate = useNav();
  const { me } = useMe();
  if (me?.authenticated && !me.is_admin) return <StaffOnly />;
  if (!me?.is_admin) return <SignInWall navigate={navigate} />;
  return (
    <Admin
      me={me}
      page={page ?? "requests"}
      navigate={navigate}
      itemId={itemId}
    />
  );
}
