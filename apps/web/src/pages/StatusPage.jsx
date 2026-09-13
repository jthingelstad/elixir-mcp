import { Status } from "../views/Status.jsx";
import { Fleet } from "../views/Collectors.jsx";
import { CollectorPage } from "../views/CollectorDetail.jsx";
import { RaiseCollector } from "../views/RaiseCollector.jsx";
import { useHere, useMe, useNav } from "../App.jsx";

/** /status/{page}/{itemId}: the service page, the fleet, a collector's
 *  record, or the raise form. */
export function StatusPage() {
  const navigate = useNav();
  const { me } = useMe();
  const { activePage, itemId } = useHere();
  if (activePage !== "collectors") return <Status navigate={navigate} />;
  if (itemId === "new") return <RaiseCollector navigate={navigate} />;
  if (itemId)
    // Keyed on the name: a re-picked card moves the record's address,
    // and the page reloads under it.
    return (
      <CollectorPage key={itemId} id={itemId} navigate={navigate} me={me} />
    );
  return <Fleet navigate={navigate} />;
}
