/** Temporary build wrapper for the legacy bucket, removed after cutover. */
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { createQueryClient } from "@elixir-mcp/client";
import { createClanRoutes } from "@elixir-mcp/clan-web/routes";
const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => null,
});
const routeTree = root.addChildren([createClanRoutes(root)]);
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() =>
    createRouter({
      routeTree,
      history: createBrowserHistory(),
      defaultPreload: false,
      scrollRestoration: true,
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
