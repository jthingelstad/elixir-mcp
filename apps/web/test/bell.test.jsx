/**
 * The bell's sheet (#765): every link out of it closes it, the rest-of-
 * the-list link included. On a Clan page the shell stays mounted across
 * the navigation, so a link that left the sheet open would leave Run's
 * Waiting behind a modal. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { BellSheet } from "../src/shell/Bell.jsx";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#2PQRJ8LV",
  name: "Ada's Clan",
  role: "leader",
  verified: true,
  members: 40,
  min_members: 10,
  needs: [
    {
      number: 41,
      type: "departure",
      label: "Departure",
      subject_name: "Ada",
      left_at: "2026-11-12T10:00:00.000Z",
    },
  ],
  needs_total: 4,
};

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test("the rest-of-the-list link closes the sheet, as each Action's does", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const onClose = vi.fn();
  const navigate = vi.fn();
  renderWithProviders(
    <BellSheet me={{}} onClose={onClose} navigate={navigate} />,
  );
  const more = await screen.findByRole("link", {
    name: /more waiting in Clan/,
    hidden: true,
  });
  fireEvent.click(more);
  expect(onClose).toHaveBeenCalledTimes(1);
});
