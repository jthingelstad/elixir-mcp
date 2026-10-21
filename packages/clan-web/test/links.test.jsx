import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NavigateProvider } from "@elixir-mcp/ui";
import { renderWithProviders } from "./helpers.jsx";
import { ELIXIR_LINKS, inApp } from "../src/lib/links.js";
import { Refused } from "../src/views/Refused.jsx";

afterEach(cleanup);

test("every link into Elixir is a path on the page's own origin", () => {
  // They were production's address: a preview or a local build sent the
  // reader to production, and every click was a page load.
  for (const [name, href] of Object.entries(ELIXIR_LINKS)) {
    expect(href, name).toMatch(/^\/(?!\/)/);
    expect(href, name).not.toContain("://");
  }
  expect(inApp(ELIXIR_LINKS.tracking)).toBe(true);
  expect(inApp(ELIXIR_LINKS.connectionsDocs)).toBe(false);
});

const refused = (reason, navigate) =>
  renderWithProviders(
    <NavigateProvider navigate={navigate}>
      <Refused reason={reason} me={{}} onRecheck={vi.fn()} checking={false} />
    </NavigateProvider>,
  );

test("a Console link is followed in the app", () => {
  const navigate = vi.fn();
  refused("no_primary_player", navigate);
  const link = screen.getByRole("link", { name: "Elixir → Tracking ›" });
  expect(link.getAttribute("href")).toBe("/console/account/tracking");
  fireEvent.click(link);
  expect(navigate).toHaveBeenCalledWith("/console/account/tracking");
});

test("a docs link is a page load: the docs are site documents", () => {
  const navigate = vi.fn();
  refused("not_a_person", navigate);
  const link = screen.getByRole("link", {
    name: "Users, agents and integrations ›",
  });
  expect(link.getAttribute("href")).toBe("/docs/connections");
  link.addEventListener("click", (e) => e.preventDefault());
  fireEvent.click(link);
  expect(navigate).not.toHaveBeenCalled();
});
