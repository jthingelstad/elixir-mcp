import { Admin } from "../views/Admin.jsx";
import { SignInWall, StaffOnly, useHere, useMe, useNav } from "../App.jsx";

/** /console/admin/{page}/{itemId}: admins only. Signed in without the role is
 *  its own state, never "Sign in first". */
export function AdminPage() {
  const navigate = useNav();
  const { me } = useMe();
  const { activePage, itemId } = useHere();
  if (me?.authenticated && !me.is_admin) return <StaffOnly />;
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
