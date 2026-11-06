import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api } from "../src/api.js";
import { Connections } from "../src/views/account/Connections.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const answer = (data) => ({ ok: true, status: 200, data });

test("New agent opens its form in place, and the page stays where it is", async () => {
  vi.spyOn(api, "connections").mockResolvedValue(
    answer({ connections: [], refusals: [] }),
  );
  vi.spyOn(api, "myPrincipals").mockResolvedValue(
    answer({
      agents: [],
      addable_clans: [{ clan_tag: "#2PQRJ8LV", name: "Example Clan" }],
    }),
  );
  const navigate = vi.fn();
  renderWithProviders(
    <Connections me={{ authenticated: true }} navigate={navigate} />,
  );
  const button = await screen.findByRole("button", { name: "New agent" });
  expect(screen.queryByLabelText("Name")).toBeNull();
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await screen.findByLabelText("Name");
  expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});
