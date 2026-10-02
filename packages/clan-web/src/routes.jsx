/** Routes join the parent application; views and their shell load on entry. */
import { lazy, createElement } from "react";
import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { CLAN } from "./lib/base.js";
const Shell = lazy(() =>
  import("./App.jsx").then((m) => ({ default: m.ClanShell })),
);
export function createClanRoutes(parent, options = {}) {
  const route = createRoute({
    getParentRoute: () => parent,
    id: "clan",
    component: () => createElement(Shell, options),
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
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/feedback/{-$id}`,
      component: lazyRouteComponent(() => import("./App.jsx"), "FeedbackPage"),
    }),
    createRoute({
      getParentRoute: () => route,
      path: `${CLAN}/maintain/{-$lane}/{-$id}`,
      component: lazyRouteComponent(() => import("./App.jsx"), "MaintainPage"),
    }),
  ]);
}
