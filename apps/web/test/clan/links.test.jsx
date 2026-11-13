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

// Clan's in-app links are the kit's one Link (2026-11-13): 35 anchors
// handled their own clicks, some taking a modified or middle click away
// from the browser, some following no link without a navigate prop.
test("a Clan link follows a plain click in the app and leaves the rest to the browser", async () => {
  const { SetupPolicy } =
    await import("../../src/clan/components/SpreadWord.jsx");
  const navigate = vi.fn();
  renderWithProviders(
    <SetupPolicy clan={{ clan_tag: "#0QC8RCGY" }} navigate={navigate} />,
  );
  const link = screen.getByRole("link", { name: "Set up the policy" });
  expect(link.getAttribute("href")).toBe("/clan/0QC8RCGY/run/about");
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"])
    expect(fireEvent.click(link, { [modifier]: true })).toBe(true);
  expect(fireEvent.click(link, { button: 1 })).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  expect(fireEvent.click(link)).toBe(false);
  expect(navigate).toHaveBeenCalledWith("/clan/0QC8RCGY/run/about");
});

/** Each opening `<a ...>` tag in `text`, braces balanced, so a handler's
 *  arrow and template literals stay inside the tag. */
function anchors(text) {
  const tags = [];
  for (const m of text.matchAll(/<a\b/g)) {
    let depth = 0;
    let end = m.index;
    for (; end < text.length; end++) {
      const c = text[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(text.slice(m.index, end + 1));
  }
  return tags;
}

test("no Clan view handles an anchor's click itself", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.resolve(import.meta.dirname, "../../src/clan");
  const files = readdirSync(dir, { recursive: true }).filter((f) =>
    String(f).endsWith(".jsx"),
  );
  expect(files.length).toBeGreaterThan(20);
  const found = [];
  for (const file of files) {
    const text = readFileSync(path.join(dir, String(file)), "utf8");
    for (const tag of anchors(text))
      if (/\bonClick=/.test(tag)) found.push(`${file}: ${tag.slice(0, 60)}`);
    // A component drawn as a bare anchor takes no part in the router.
    if (/\bas="a"/.test(text)) found.push(`${file}: as="a"`);
  }
  expect(found).toEqual([]);
});

test("the anchor scan sees a handler with arrows and template literals", () => {
  const [tag] = anchors(
    "<a\n  href={`${base}/feed`}\n  onClick={(e) => {\n    e.preventDefault();\n    navigate?.(`${base}/feed`);\n  }}\n>Feed</a>",
  );
  expect(tag).toMatch(/onClick=/);
  expect(tag.endsWith("}\n>")).toBe(true);
});
