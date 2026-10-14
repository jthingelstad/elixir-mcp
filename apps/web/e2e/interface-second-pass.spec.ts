import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./clan/fixtures.ts";
import {
  ACTIVITY_CHANNEL,
  EMAILS,
  RECRUIT,
} from "./interface-second-fixtures.ts";

for (const width of [390, 820, 1280]) {
  test(`email choices retain schedules and saved switches at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const mail = structuredClone(EMAILS);
    const writes: unknown[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/me/email": () => [200, mail],
        "PUT /api/me/email": (route) => {
          const change = route.request().postDataJSON();
          writes.push(change);
          mail.kinds.forEach((k) => {
            if (change.kind === "all" || change.kind === k.kind)
              k.enabled = change.enabled;
          });
          return [200, change];
        },
      }),
    );
    await page.goto("/console/account/profile/email");
    const scheduled = page.getByRole("region", {
      name: "Scheduled",
      exact: true,
    });
    await expect(scheduled.getByRole("switch")).toHaveCount(4);
    await expect(
      page
        .getByRole("region", { name: "When something happens" })
        .getByRole("switch"),
    ).toHaveCount(3);
    await expect(
      scheduled.getByText("Monday · 9:00 am Central", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(8);
    await page
      .getByRole("switch", { name: "Clan report email", exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: "Clan report email", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    expect(writes).toEqual([{ kind: "clan_report", enabled: false }]);
    await page
      .getByRole("switch", { name: "Every email", exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: "Clan report email", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    expect(writes).toEqual([
      { kind: "clan_report", enabled: false },
      { kind: "all", enabled: true },
    ]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-second-email-${width}.png`,
      fullPage: false,
    });
  });

  test(`Discord contextual editors discard drafts and restore focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") writes.push(r.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/activity-discord": [
          200,
          ACTIVITY_CHANNEL,
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/discord");
    const trigger = page.getByRole("button", {
      name: "Manage Activity channel",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    await expect(
      page.getByText("Members · Milestones · Clan Wars", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Replace it with another webhook"),
    ).toHaveCount(0);
    await page.screenshot({
      path: `/tmp/elixir-second-discord-${width}.png`,
      fullPage: false,
    });
    await trigger.click();
    await page
      .getByLabel("Replace it with another webhook")
      .fill("https://discord.com/api/webhooks/123/fixture-unsaved");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(
      page.getByLabel("Replace it with another webhook"),
    ).toHaveValue("");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Manage Channel voice", exact: true })
      .click();
    await page.getByLabel("How the posts should sound").fill("Unsaved voice");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Manage Channel voice", exact: true })
      .click();
    await expect(page.getByLabel("How the posts should sound")).toHaveValue(
      "Warm and concise.",
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(writes).toEqual([]);
  });

  test(`Recruit keeps each format's local edits and leads with the copy at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/recruit": [200, RECRUIT],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/recruit");
    const note = page.getByRole("textbox", {
      name: "Personal note",
      exact: true,
    });
    await expect(note).toBeVisible();
    const box = await note.boundingBox();
    expect(box!.y).toBeLessThan(450); // The copy begins in the first half of the viewport.
    await page.screenshot({
      path: `/tmp/elixir-second-recruit-${width}.png`,
      fullPage: false,
    });
    await note.fill("A personal draft to keep");
    await page.getByLabel("Format", { exact: true }).selectOption("post");
    const post = page.getByRole("textbox", {
      name: "Public post",
      exact: true,
    });
    await expect(post).toHaveValue(/Required Trophies: \[7500\]/);
    await post.fill("A public draft to keep");
    await page.getByLabel("Format", { exact: true }).selectOption("personal");
    await expect(note).toHaveValue("A personal draft to keep");
    await page.getByLabel("Format", { exact: true }).selectOption("post");
    await expect(post).toHaveValue("A public draft to keep");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(post).toHaveValue(/Required Trophies: \[7500\]/);
    await page.getByText("The pitch · v1", { exact: true }).click();
    await expect(
      page.getByText("Steady wars, friendly chat", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
  });
}
