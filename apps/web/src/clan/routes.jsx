/** Clan's routes in the app's route tree; its pages load on entry. */
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { CLAN } from "./lib/base.js";
export function createClanRoutes(parent) {
  const route = createRoute({
    getParentRoute: () => parent,
    id: "clan",
    component: lazyRouteComponent(() => import("./App.jsx"), "ClanLayout"),
  });
  return route.addChildren([
    createRoute({
      getParentRoute: () => route,
      path: CLAN,
      component: lazyRouteComponent(() => import("./App.jsx"), "LandingPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/clans`,
      component: lazyRouteComponent(() => import("./App.jsx"), "ClansPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/$tag/{-$section}/{-$tab}`,
      component: lazyRouteComponent(() => import("./App.jsx"), "ClanPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/directory`,
      component: lazyRouteComponent(() => import("./App.jsx"), "DirectoryPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/you/{-$sub}`,
      component: lazyRouteComponent(() => import("./App.jsx"), "YouPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/refused/$reason`,
      component: lazyRouteComponent(() => import("./App.jsx"), "RefusedPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/verify`,
      component: lazyRouteComponent(() => import("./App.jsx"), "VerifyPage"),
    }),
  ]);
}
