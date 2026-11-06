import { Status } from "../views/Status.jsx";
import { Fleet } from "../views/Collectors.jsx";
import { Efficiency } from "../views/Efficiency.jsx";
import { CollectorPage } from "../views/CollectorDetail.jsx";
import { useHere, useMe, useNav } from "../App.jsx";

/** /data/service, the service page, and /console/status/{page}/{itemId}: the
 *  fleet, a collector's record, the raise form, efficiency. */
export function StatusPage() {
  const navigate = useNav();
  const { me } = useMe();
  const { activePage, itemId } = useHere();
  if (activePage === "efficiency") return <Efficiency navigate={navigate} />;
  if (activePage !== "collectors") return <Status navigate={navigate} />;
  if (itemId)
    // Keyed on the name: a re-picked card moves the record's address,
    // and the page reloads under it.
    return (
      <CollectorPage key={itemId} id={itemId} navigate={navigate} me={me} />
    );
  return <Fleet navigate={navigate} />;
}
