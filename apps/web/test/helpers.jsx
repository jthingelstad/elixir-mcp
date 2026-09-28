import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@elixir-mcp/client";
import { NavigateProvider } from "@elixir-mcp/ui";

/**
 * Render a view the way the app renders it: inside a query provider.
 * A fresh client per render, so nothing a previous test fetched can be
 * served from cache here. Retries are off: a test that mocks a failure
 * wants to see the failure, not wait 1.5 s for the second try.
 *
 * A view handed a `navigate` prop gets the same function as the app's
 * NavigateProvider, the way the Shell supplies both, so a test's spy
 * sees the in-app click of every kit Link inside it.
 */
export function renderWithProviders(ui, options) {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  const navigate = ui?.props?.navigate;
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>
      {typeof navigate === "function" ? (
        <NavigateProvider navigate={navigate}>{children}</NavigateProvider>
      ) : (
        children
      )}
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper, ...options }), queryClient: client };
}
