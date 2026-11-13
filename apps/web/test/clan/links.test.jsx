import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NavigateProvider } from "@elixir-mcp/ui";
import { renderWithProviders } from "./helpers.jsx";
import { REFUSALS, Refused } from "../../src/clan/views/Refused.jsx";

afterEach(cleanup);

test("every refusal links to a path on the page's own origin", () => {
  // They were production's address: a preview or a local build sent the
  // reader to production, and every click was a page load.
  for (const [reason, page] of Object.entries(REFUSALS)) {
    for (const href of [page.link[0], page.also?.[0]].filter(Boolean)) {
      expect(href, reason).toMatch(/^\/(?!\/)/);
      expect(href, reason).not.toContain("://");
    }
  }
});

const refused = (reason, navigate) =>
  renderWithProviders(
    <NavigateProvider navigate={navigate}>
      <Refused reason={reason} me={{}} onRecheck={vi.fn()} checking={false} />
    </NavigateProvider>,
  );

test("a Settings link is followed in the app", () => {
  const navigate = vi.fn();
  refused("membership_unknown", navigate);
  const link = screen.getByRole("link", { name: "Settings → Players ›" });
  expect(link.getAttribute("href")).toBe("/settings/players");
  fireEvent.click(link);
  expect(navigate).toHaveBeenCalledWith("/settings/players");
});
