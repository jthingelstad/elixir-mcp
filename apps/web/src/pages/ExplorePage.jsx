import { Explore } from "../views/Explore.jsx";
import { useHere, useMe, useNav } from "../App.jsx";

/** /explore/*: the record browser resolves its own paths. */
export function ExplorePage() {
  const navigate = useNav();
  const { me } = useMe();
  const { path } = useHere();
  return <Explore me={me} navigate={navigate} path={path} />;
}
