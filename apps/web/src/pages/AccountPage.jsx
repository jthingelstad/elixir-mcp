import { useLocation } from "@tanstack/react-router";
import { Dashboard } from "../views/Dashboard.jsx";
import { useHere, useMe, useNav } from "../App.jsx";

/** /console/account/{page}/{itemId}/{recordId}: the Account section's pages,
 *  through the Dashboard switch, with the props they always took. */
export function AccountPage() {
  const navigate = useNav();
  const { me, refresh } = useMe();
  const { activePage, here, itemId, recordId, search } = useHere();
  // The router's, not the window's: on an in-app move the page renders
  // before the address bar has the new hash.
  const { hash } = useLocation();
  return (
    <Dashboard
      me={me}
      refresh={refresh}
      navigate={navigate}
      page={activePage ?? "overview"}
      sub={here.sub}
      itemId={itemId}
      recordId={recordId}
      search={search}
      hash={hash}
    />
  );
}
