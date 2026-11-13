import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  agoPlain,
  Avatar,
  avatarHue,
  avatarInitials,
  Chips,
  Empty,
  ErrorState,
  FreshChip,
  PageHead,
  Panel,
  Row,
  Rows,
  Stat,
  Stats,
  Table,
  Tabs,
  useScrollHint,
} from "../src/index.ts";
import { useRef } from "react";

afterEach(cleanup);

describe("PageHead", () => {
  test("one h1, one sub line, and the right-hand slot", () => {
    render(
      <PageHead title="Season" sub="One line." aside={<a href="/x">Pick</a>} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Season",
    );
    expect(screen.getByText("One line.").tagName).toBe("P");
    expect(screen.getByRole("link", { name: "Pick" })).toBeTruthy();
  });

  test("no empty boxes for what a page does not have", () => {
    const { container } = render(<PageHead title="Season" />);
    expect(container.querySelector(".kit-head__sub")).toBeNull();
    expect(container.querySelector(".kit-head__side")).toBeNull();
  });
});

describe("FreshChip", () => {
  test("a folded native details: the age, then the plain explanation", () => {
    const { container } = render(
      <FreshChip seconds={900}>The game keeps the last battles.</FreshChip>,
    );
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(container.querySelector("summary")?.textContent).toContain(
      "Battle log read 15 min ago",
    );
    expect(details?.textContent).toContain("The game keeps the last battles.");
  });

  test("never read is said, and is not a time", () => {
    const { container } = render(<FreshChip>Why.</FreshChip>);
    expect(container.querySelector(".kit-fresh--never")).toBeTruthy();
    expect(container.textContent).not.toMatch(/ago/);
  });

  test("agoPlain reads as a person says it", () => {
    expect(agoPlain(10)).toBe("just now");
    expect(agoPlain(900)).toBe("15 min ago");
    expect(agoPlain(7200)).toBe("2 hr ago");
    expect(agoPlain(3 * 86400)).toBe("3 days ago");
  });
});

describe("Tabs", () => {
  test("a mark says something is new without claiming a count", () => {
    render(
      <Tabs
        label="Home"
        items={[{ key: "a", label: "A", mark: true, markLabel: "New here" }]}
        value="a"
      />,
    );
    expect(
      screen.getByText("New here").closest(".kit-tabs__mark"),
    ).toBeTruthy();
    expect(document.querySelector(".kit-tabs__count")).toBeNull();
  });

  const items = [
    { key: "a", label: "Timeline", count: 3 },
    { key: "b", label: "Roster" },
    { key: "c", label: "Season" },
  ];

  test("a real tablist with the open one selected and a count badge", () => {
    render(<Tabs label="Clan" items={items} value="b" onSelect={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Clan" })).toBeTruthy();
    const all = screen.getAllByRole("tab");
    expect(all.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(all[0]!.textContent).toBe("Timeline3");
    // One tab stop: the open one.
    expect(all.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  test("arrow, Home and End move focus and wrap; a click selects", () => {
    const onSelect = vi.fn();
    render(<Tabs label="Clan" items={items} value="a" onSelect={onSelect} />);
    const all = screen.getAllByRole("tab");
    all[0]!.focus();
    fireEvent.keyDown(all[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(all[2]!);
    fireEvent.keyDown(all[2]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(all[0]!);
    fireEvent.keyDown(all[0]!, { key: "End" });
    expect(document.activeElement).toBe(all[2]!);
    fireEvent.keyDown(all[2]!, { key: "Home" });
    expect(document.activeElement).toBe(all[0]!);
    fireEvent.click(all[1]!);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  test("a tab with an href is a link, keeping the role and its address", () => {
    render(
      <Tabs
        label="Clan"
        value="a"
        items={[{ key: "a", label: "Timeline", href: "/clan/timeline" }]}
      />,
    );
    const tab = screen.getByRole("tab", { name: "Timeline" });
    expect(tab.tagName).toBe("A");
    expect(tab.getAttribute("href")).toBe("/clan/timeline");
  });

  test("a count can say what it counts, read aloud after the number", () => {
    render(
      <Tabs
        label="Clan"
        value="a"
        items={[{ key: "a", label: "Today", count: 2, countLabel: "waiting" }]}
      />,
    );
    expect(screen.getByRole("tab").textContent).toBe("Today 2 waiting");
  });
});

describe("Chips", () => {
  test("one pressed, named as a group", () => {
    const onChange = vi.fn();
    render(
      <Chips
        label="Filter"
        value="all"
        onChange={onChange}
        options={[
          { key: "all", label: "All" },
          { key: "clans", label: "Clans", count: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
    const clans = screen.getByRole("button", { name: /Clans/ });
    expect(clans.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(clans);
    expect(onChange).toHaveBeenCalledWith("clans");
  });
});

describe("Panel and Rows", () => {
  test("a titled section is a named region, its link on the right", () => {
    render(
      <Panel title="Decks" action={<a href="/d">All decks</a>}>
        <p>Body</p>
      </Panel>,
    );
    const region = screen.getByRole("region", { name: "Decks" });
    expect(region.querySelector(".kit-panel__action a")?.textContent).toBe(
      "All decks",
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Decks");
  });

  test("no title, no head", () => {
    const { container } = render(<Panel>Body</Panel>);
    expect(container.querySelector(".kit-panel__head")).toBeNull();
  });

  test("a row with an href is one link, and its detail stays inside it", () => {
    render(
      <Rows>
        <Row title="A week" detail="Three races" right="12" href="/w" />
        <Row title="Quiet" />
      </Rows>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/w");
    expect(link.textContent).toContain("Three races");
    expect(screen.getByText("Quiet")).toBeTruthy();
  });
});

describe("Table", () => {
  const rows = [
    { id: "a", name: "First", n: 12 },
    { id: "b", name: "Second", n: 3 },
  ];
  const columns = [
    {
      head: "Name",
      cell: (r: (typeof rows)[number]) => r.name,
    },
    { head: "Count", num: true, cell: (r: (typeof rows)[number]) => r.n },
  ];

  test("real headers with scope, numbers marked, phone labels on cells", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map((h) => h.tagName)).toEqual(["TH", "TH"]);
    expect(heads.map((h) => h.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(heads[1]!.className).toContain("kit-table__num");
    const cells = screen.getAllByRole("cell");
    expect(cells[1]!.className).toContain("kit-table__num");
    expect(cells[0]!.getAttribute("data-h")).toBe("Name");
    expect(cells[1]!.getAttribute("data-h")).toBe("Count");
    expect(cells[0]!.className).toContain("kit-table__lead");
  });

  test("a row-naming column is a th scoped to its row", () => {
    render(
      <Table
        columns={[{ head: "Name", rowHeader: true, cell: () => "First" }]}
        rows={[rows[0]!]}
      />,
    );
    const cell = screen.getByRole("rowheader");
    expect(cell.tagName).toBe("TH");
    expect(cell.getAttribute("scope")).toBe("row");
  });

  test("sections are separate tbodies, and the foot sits under them", () => {
    const { container } = render(
      <Table
        columns={columns}
        groups={[
          { key: "x", rows: [rows[0]!] },
          { key: "y", rows: [rows[1]!] },
        ]}
        foot="More"
      />,
    );
    expect(container.querySelectorAll("tbody")).toHaveLength(3);
    expect(container.querySelector("tbody:last-child td")?.textContent).toBe(
      "More",
    );
  });

  test("no rows: the empty line, across the whole table", () => {
    render(<Table columns={columns} rows={[]} empty="Nothing yet." />);
    const cell = screen.getByRole("cell", { name: "Nothing yet." });
    expect(cell.getAttribute("colspan")).toBe("2");
  });

  test("a row can carry a full-width row after it", () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        rowAfter={(r) => (r.id === "a" ? "Detail" : null)}
      />,
    );
    expect(screen.getByRole("cell", { name: "Detail" })).toBeTruthy();
    // A header, two rows, one detail row.
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  test("a list has no header row and no phone labels", () => {
    const { container } = render(
      <Table columns={columns} rows={rows} noHead />,
    );
    expect(container.querySelector("thead")).toBeNull();
    expect(container.querySelector("[data-h]")).toBeNull();
  });

  test("the phone mode is on the box and the table", () => {
    const { container } = render(
      <Table columns={columns} rows={rows} phone="fit" region="Named" />,
    );
    expect(container.querySelector(".kit-table-box--fit")).toBeTruthy();
    expect(container.querySelector(".kit-table--fit")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Named" })).toBeTruthy();
  });
});

describe("Empty and ErrorState", () => {
  test("title, one line, one action", () => {
    render(
      <Empty title="No decks" action={<a href="/x">Add one</a>}>
        Nothing was recorded.
      </Empty>,
    );
    expect(screen.getByText("No decks").className).toContain("empty__title");
    expect(screen.getByText("Nothing was recorded.").tagName).toBe("P");
    expect(screen.getByRole("link", { name: "Add one" })).toBeTruthy();
  });

  test("a failed read is said, and Try again appears only with a retry", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState />);
    expect(screen.getByRole("alert").textContent).toContain(
      "This could not be read just now",
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("Stats", () => {
  test("label, value, the whole it is out of, and a note", () => {
    render(
      <Stats label="Recruiting facts">
        <Stat label="Members" value="42" of="of 50" note="today" tone="ok" />
      </Stats>,
    );
    const group = screen.getByRole("group", { name: "Recruiting facts" });
    expect(group.textContent).toBe("Members42 of 50today");
    expect(group.querySelector(".kit-stat__value--ok")).toBeTruthy();
  });
});

describe("Avatar", () => {
  test("initials from a name: two words' first letters, else its first two", () => {
    expect(avatarInitials("POAP KINGS")).toBe("PK");
    expect(avatarInitials("ZappyZebra")).toBe("ZA");
    expect(avatarInitials("rosa_rumble")).toBe("RR");
    expect(avatarInitials("")).toBe("?");
  });

  test("a fill from the tag, the same every time, one of seven", () => {
    const h = avatarHue("#09Q289CV");
    expect(h).toBe(avatarHue("#09Q289CV"));
    expect(h).toBeGreaterThanOrEqual(1);
    expect(h).toBeLessThanOrEqual(7);
  });

  test("drawn for the eye only: the name beside it is what is heard", () => {
    const { container } = render(<Avatar name="Lark" tag="#0YGLPJ0Q" small />);
    const el = container.querySelector(".kit-av");
    expect(el?.getAttribute("aria-hidden")).toBe("true");
    expect(el?.className).toMatch(/kit-av--s/);
    const clan = render(<Avatar name="POAP KINGS" clan />).container;
    expect(clan.querySelector(".kit-av--clan")?.textContent).toBe("PK");
  });
});

describe("Row's lead", () => {
  test("an avatar before the words, only when given", () => {
    const { container } = render(
      <Row title="Lark" lead={<Avatar name="Lark" />} />,
    );
    expect(container.querySelector(".kit-row__lead .kit-av")).toBeTruthy();
    const bare = render(<Row title="Pell" />).container;
    expect(bare.querySelector(".kit-row__lead")).toBeNull();
  });
});

describe("useScrollHint", () => {
  function Row({ focusable }: { focusable?: boolean }) {
    const row = useRef<HTMLUListElement>(null);
    useScrollHint(row, { focusable });
    return (
      <ul ref={row} aria-label="Facts">
        <li>One</li>
      </ul>
    );
  }
  const widths = (scroll: number, client: number) => {
    const proto = HTMLElement.prototype;
    const was = {
      scroll: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
      client: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    };
    Object.defineProperty(proto, "scrollWidth", {
      configurable: true,
      get: () => scroll,
    });
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get: () => client,
    });
    return () => {
      if (was.scroll) Object.defineProperty(proto, "scrollWidth", was.scroll);
      if (was.client) Object.defineProperty(proto, "clientWidth", was.client);
    };
  };
  test("a row of facts that scrolls is a tab stop and fades its far edge", () => {
    const restore = widths(300, 100);
    try {
      render(<Row focusable />);
      const row = screen.getByRole("list", { name: "Facts" });
      expect(row.getAttribute("tabindex")).toBe("0");
      expect(row.hasAttribute("data-more-right")).toBe(true);
      expect(row.hasAttribute("data-more-left")).toBe(false);
    } finally {
      restore();
    }
  });
  test("a row that fits is no tab stop, and a row of controls never is", () => {
    const restore = widths(100, 100);
    try {
      render(<Row focusable />);
      expect(
        screen.getByRole("list", { name: "Facts" }).hasAttribute("tabindex"),
      ).toBe(false);
    } finally {
      restore();
    }
    cleanup();
    const again = widths(300, 100);
    try {
      render(<Row />);
      expect(
        screen.getByRole("list", { name: "Facts" }).hasAttribute("tabindex"),
      ).toBe(false);
    } finally {
      again();
    }
  });
});
