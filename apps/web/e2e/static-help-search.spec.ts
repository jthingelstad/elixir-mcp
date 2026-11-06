import { test, expect, type Page } from "@playwright/test";
import { SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

/** A static page chooses its face from the app's hint, so a test sets it the
 *  way the app does. */
async function signedInFace(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "elixir.session",
      JSON.stringify({ until: Date.now() + 3_600_000, name: "Sam Sample" }),
    );
  });
}

test.describe("Search from a static page", () => {
  test("/home?search opens the sheet and cleans the address", async ({
    page,
  }) => {
    await mockApi(page, signedIn());
    await page.goto("/home?search");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("a static page's Search link lands on the open sheet", async ({
    page,
  }) => {
    await signedInFace(page);
    await mockApi(page, signedIn());
    await page.goto("/docs");
    await page.locator("a.kit-top__search").click();
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  });

  test("signed out, ?search opens nothing", async ({ page }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/home?search");
    await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
  });
});

test.describe("Help on a static page", () => {
  const note = "The chart on this page looks wrong.";

  async function openAndWrite(page: Page) {
    await signedInFace(page);
    await page.goto("/support");
    await page.locator("button.kit-top__icon[data-help-open]").click();
    const box = page.locator("dialog[data-help]");
    await expect(box).toBeVisible();
    const send = box.locator("[data-help-send]");
    await expect(send).toBeDisabled();
    await box.locator("[data-help-note]").fill(note);
    await expect(send).toBeEnabled();
    return { box, send };
  }

  test("sends the note with the page riding along, then says so", async ({
    page,
  }) => {
    const posted: unknown[] = [];
    await page.route("**/api/feedback", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    const { box, send } = await openAndWrite(page);
    await send.click();
    await expect(box.locator("[data-help-done]")).toBeVisible();
    await expect(box.locator("[data-help-note]")).toBeHidden();
    await expect(send).toBeHidden();
    expect(posted).toEqual([
      {
        message: note,
        category: "general",
        area: "console",
        context: { path: "/support", page: expect.any(String) },
      },
    ]);
  });

  test("a send that fails keeps the note and says so", async ({ page }) => {
    await page.route("**/api/feedback", (route) =>
      route.fulfill({ status: 500, json: { error: "internal" } }),
    );
    const { box, send } = await openAndWrite(page);
    await send.click();
    await expect(box.locator("[data-help-error]")).toContainText(
      "That did not send",
    );
    await expect(box.locator("[data-help-note]")).toHaveValue(note);
    await expect(box.locator("[data-help-done]")).toBeHidden();
    await expect(send).toBeEnabled();
  });

  test("signed out, no Help or Search shows", async ({ page }) => {
    await page.goto("/support");
    await expect(page.locator("[data-help-open]:visible")).toHaveCount(0);
    await expect(page.locator("a.kit-top__search:visible")).toHaveCount(0);
  });
});
