import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Recruit } from "../src/views/Recruit.jsx";
import { manageApi } from "../src/api.js";
import { railItems, railKey } from "../src/lib/rail.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "member" };
const view = (extra = {}) => ({
  clan_tag: "#2PQRJ8LV",
  can_edit: false,
  pitch: {
    tagline: "Steady wars, friendly chat",
    about: "About us.",
    points: ["Wars every week"],
    looking_for: "Active players.",
    website_url: "https://example.org",
    contact: "Request in game.",
  },
  pitch_version: 1,
  fields: {},
  facts: {
    name: "Example Clan",
    tag: "#2PQRJ8LV",
    type: "inviteOnly",
    members: 47,
    open_slots: 3,
    required_trophies: 5000,
    clan_score: 61234,
    war_trophies: 3210,
    donations_per_week: 8400,
    top_trophies: [{ name: "Ada", value: 9000 }],
    top_donors: [],
    source: "live",
  },
  facts_read_at: "2026-09-13T12:00:00Z",
  facts_cached: true,
  pending: null,
  copy: {
    personal: { subject: "Join Example Clan", body: "Body." },
    post: {
      title: "Example Clan #2PQRJ8LV - Steady wars [5000]",
      body: "About us.\n\nRequired Trophies: [5000]",
    },
  },
  problems: [],
  versions: [],
  ...extra,
});

describe("recruit", () => {
  test("shows the facts, the pitch, and the two formats a member can edit, reset and copy", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: view(),
    });
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(<Recruit clan={poap} />);
    const facts = await screen.findByRole("group", {
      name: "Recruiting facts",
    });
    expect(within(facts).getByText(/47 members · 3 open/)).toBeTruthy();
    expect(
      within(facts).getByText(/5,000 trophies · invite only/),
    ).toBeTruthy();
    expect(screen.getByText("Steady wars, friendly chat")).toBeTruthy();
    const personal = screen.getByLabelText("Personal note");
    expect(personal.value).toMatch(/^Subject: Join Example Clan/);
    fireEvent.change(personal, { target: { value: "My personal note" } });
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "post" },
    });
    expect(screen.queryByLabelText("Personal note")).toBeNull();
    const post = screen.getByLabelText("Public post");
    expect(post.value).toMatch(/^Title: Example Clan #2PQRJ8LV - .* \[5000\]/);
    expect(post.value).toMatch(/Required Trophies: \[5000\]/);

    expect(screen.queryByLabelText("Discord post")).toBeNull();
    expect(screen.queryByLabelText("Reddit post")).toBeNull();
    fireEvent.change(post, { target: { value: "my own words" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the public post" }),
    );
    await waitFor(() => expect(write).toHaveBeenCalledWith("my own words"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Public post").value).toMatch(
      /Required Trophies/,
    );
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "personal" },
    });
    expect(screen.getByLabelText("Personal note").value).toBe(
      "My personal note",
    );
    expect(screen.queryByText("edit the pitch")).toBeNull();
  });

  test("a pending live read says so and the record stands in; an edited-away requirement is shown", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        facts: {
          name: "Example Clan",
          members: 47,
          open_slots: 3,
          required_trophies: null,
          top_trophies: [],
          top_donors: [],
          source: "recorded",
        },
        pending: { retry_after_s: 30 },
        problems: ["the post title carries [5000]"],
      }),
    });
    renderWithProviders(<Recruit clan={poap} />);
    expect(await screen.findByText(/fresh read queued/)).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Recruiting facts" })).getByText(
        /not in the record yet/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Check before posting: the post title carries/),
    ).toBeTruthy();
  });

  test("before a leader writes the pitch there is no copy", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        pitch: {
          tagline: "",
          about: "",
          points: [],
          looking_for: "",
          website_url: "",
          contact: "",
        },
        pitch_version: 0,
        copy: null,
      }),
    });
    renderWithProviders(<Recruit clan={poap} />);
    expect(
      await screen.findByText(/has not written the clan's pitch yet/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Public post")).toBeNull();
  });

  test("the rail offers Recruit to every member", () => {
    const me = {
      ok: true,
      selected: { clan_tag: "#2PQRJ8LV", role: "member" },
      clans: [{}],
    };
    expect(railItems(me).map((r) => r.key)).toContain("recruit");
    expect(railKey("/clan/2PQRJ8LV/recruit")).toBe("recruit");
  });
});

test("a public-copy refresh leaves an unchanged personal source's draft intact", async () => {
  const d = view();
  const read = vi
    .spyOn(manageApi, "recruit")
    .mockResolvedValue({ ok: true, status: 200, data: d });
  const { queryClient } = renderWithProviders(<Recruit clan={poap} />);
  fireEvent.change(await screen.findByLabelText("Personal note"), {
    target: { value: "Keep this personal draft" },
  });
  read.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ...d,
      copy: {
        ...d.copy,
        post: { title: "Updated title", body: "Updated public source" },
      },
    },
  });
  await act(async () => {
    await queryClient.invalidateQueries();
  });
  fireEvent.change(screen.getByLabelText("Format"), {
    target: { value: "post" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Public post").value).toContain(
      "Updated public source",
    ),
  );
  fireEvent.change(screen.getByLabelText("Format"), {
    target: { value: "personal" },
  });
  expect(screen.getByLabelText("Personal note").value).toBe(
    "Keep this personal draft",
  );
});
