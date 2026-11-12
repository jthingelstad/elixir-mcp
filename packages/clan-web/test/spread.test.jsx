import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { SpreadWord, SpreadWordFoot } from "../src/components/SpreadWord.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = (role) => ({
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role,
});
const roster = (n) => ({ name: "Example Clan", member_count: n, members: [] });
const me = (policy) => ({ policy });

describe("spread the word", () => {
  test("a member of a clan with no policy invites the leaders, with a chat line and the link", async () => {
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("member")}
        roster={roster(24)}
      />,
    );
    expect(screen.getByText("Invite your leaders")).toBeTruthy();
    const [line] = screen.getAllByRole("button", {
      name: "Copy for clan chat",
    });
    fireEvent.click(line);
    await waitFor(() => expect(write).toHaveBeenCalled());
    const text = write.mock.calls[0][0];
    expect(text).toMatch(/^Leaders: I use Elixir/);
    expect(text).toMatch(/Example Clan/);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).not.toMatch(/https?:|&|\+\d/);
  });

  test("a leader of a clan with no policy is sent to set it up", () => {
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("coLeader")}
        roster={roster(24)}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByText("Set up how the clan runs")).toBeTruthy();
    expect(screen.getByText(/each with its own log/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Set up the policy" }),
    ).toBeTruthy();
  });

  test("below 10 members the card points a leader at Recruit", () => {
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("leader")}
        roster={roster(6)}
      />,
    );
    expect(
      screen.getByText("Clan management starts at 10 members"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Recruit" })).toBeTruthy();
  });

  test("small-clan leaders can prepare policy; elders and up keep the recruiting path, members are not sent to it", () => {
    for (const role of ["leader", "coLeader", "elder", "member"]) {
      const navigate = vi.fn();
      renderWithProviders(
        <SpreadWord
          me={me({ set: false, active: false })}
          clan={clan(role)}
          roster={roster(1)}
          navigate={navigate}
        />,
      );
      const open = screen.queryByRole("link", { name: "Open Recruit" });
      if (role === "member") expect(open).toBeNull();
      else expect(open).toBeTruthy();
      const link = screen.queryByRole("link", { name: "Prepare the policy" });
      if (["leader", "coLeader"].includes(role)) {
        expect(link.getAttribute("href")).toBe("/clan/2PQRJ8LV/run/about");
        fireEvent.click(link);
        expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/run/about");
        expect(
          screen.getByText(/Leaders can prepare and save the policy now/),
        ).toBeTruthy();
      } else expect(link).toBeNull();
      cleanup();
    }
  });

  test("with an active policy, anyone can bring clanmates in, at the roster's foot; Recruit is the elders' and up", () => {
    const { container } = renderWithProviders(
      <SpreadWord
        me={me({ set: true, active: true })}
        clan={clan("member")}
        roster={roster(30)}
      />,
    );
    expect(container.textContent).toBe("");
    const onRecruit = vi.fn();
    renderWithProviders(
      <SpreadWordFoot
        me={me({ set: true, active: true })}
        clan={clan("member")}
        roster={roster(30)}
        recruit={null}
        onRecruit={onRecruit}
      />,
    );
    expect(screen.getByText("Bring your clanmates")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /recruiting copy/ }),
    ).toBeNull();
    cleanup();
    renderWithProviders(
      <SpreadWordFoot
        me={me({ set: true, active: true })}
        clan={clan("elder")}
        roster={roster(30)}
        recruit={null}
        onRecruit={onRecruit}
      />,
    );
    expect(screen.getByText("Bring your clanmates")).toBeTruthy();
    const open = screen.getByRole("button", {
      name: "Write the recruiting copy",
    });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(onRecruit).toHaveBeenCalledWith(true);
  });

  test("before the policy, the foot still offers the recruiting copy, open when asked", () => {
    renderWithProviders(
      <SpreadWordFoot
        me={me({ set: false, active: false })}
        clan={clan("elder")}
        roster={roster(24)}
        recruit={<p>The pitch</p>}
      />,
    );
    expect(screen.queryByText("Bring your clanmates")).toBeNull();
    expect(screen.getByText("The pitch")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Hide the recruiting copy" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  test("a member with no active policy has no foot, and Recruit's address gives its role line", () => {
    const { container } = renderWithProviders(
      <SpreadWordFoot
        me={me({ set: false, active: false })}
        clan={clan("member")}
        roster={roster(24)}
        recruit={<p>The pitch</p>}
      />,
    );
    expect(container.textContent).toBe("");
    cleanup();
    renderWithProviders(
      <SpreadWordFoot
        me={me({ set: false, active: false })}
        clan={clan("member")}
        roster={roster(24)}
        recruit={<p>The pitch</p>}
        show="recruit"
      />,
    );
    expect(
      screen.getByText(/Recruit is for elders, co-leaders and the leader/),
    ).toBeTruthy();
    expect(screen.queryByText("The pitch")).toBeNull();
  });

  test("an unverified elder is a member here", () => {
    const { container } = renderWithProviders(
      <SpreadWordFoot
        me={me({ set: false, active: false })}
        clan={{ ...clan("elder"), verified: false }}
        roster={roster(24)}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
