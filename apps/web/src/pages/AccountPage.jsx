import { Dashboard } from "../views/Dashboard.jsx";
import { useHere, useMe, useNav } from "../App.jsx";

/** /account/{page}/{itemId}/{recordId}: the Account section's pages,
 *  through the Dashboard switch, with the props they always took. */
export function AccountPage() {
  const navigate = useNav();
  const { me, refresh } = useMe();
  const { activePage, here, itemId, recordId } = useHere();
  return (
    <Dashboard
      me={me}
      refresh={refresh}
      navigate={navigate}
      page={activePage ?? "overview"}
      sub={here.sub}
      itemId={itemId}
      recordId={recordId}
    />
  );
}
