import { Admin } from "../views/Admin.jsx";
import { SignInWall, useHere, useMe, useNav } from "../App.jsx";

/** /admin/{page}/{itemId}: admins only; anyone else meets the wall. */
export function AdminPage() {
  const navigate = useNav();
  const { me } = useMe();
  const { activePage, itemId } = useHere();
  if (!me?.is_admin) return <SignInWall navigate={navigate} />;
  return (
    <Admin
      me={me}
      page={activePage ?? "requests"}
      navigate={navigate}
      itemId={itemId}
    />
  );
}
