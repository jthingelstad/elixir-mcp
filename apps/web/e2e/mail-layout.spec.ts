import { test, expect } from "@playwright/test";
import { mailPreviewCases } from "../../../packages/mail/scripts/preview-cases.mjs";
import { renderMail } from "../../../packages/mail/src/index.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";

// Email clients can block every image. Layout and actions must still fit,
// independent of the locally mirrored art used for the visual review.
for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1280, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`all email variants fit with images blocked at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.route("**/*", (route) => route.abort());
    for (const specimen of mailPreviewCases()) {
      const { message, kind, facts, name } = specimen;
      const mail = message
        ? renderEmail(message)
        : renderMail(kind, facts, {
            unsubscribe:
              "https://elixir.poapkings.com/api/email/unsubscribe?t=preview",
            manage: "https://elixir.poapkings.com/settings/emails",
            send_id: "00000000-0000-4000-8000-000000000000",
            pixel: false,
          });
      await page.setContent(mail.html, { waitUntil: "load" });
      await expect(page.locator("body")).toContainText(
        "not endorsed by Supercell",
      );
      const overflow = await page.evaluate(() => {
        const width = window.innerWidth;
        return Array.from(document.querySelectorAll("body *"))
          .filter((el) => el.getBoundingClientRect().right > width + 1)
          .map((el) => ({
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 80),
            right: el.getBoundingClientRect().right,
          }));
      });
      expect(overflow, `${name} at ${viewport.width}px`).toEqual([]);
      for (const button of await page.locator('a[target="_blank"]').all()) {
        const bounds = await button.boundingBox();
        expect(
          bounds?.height,
          `${name}: primary action remains easy to tap`,
        ).toBeGreaterThanOrEqual(44);
      }
      if (
        ["tracking_report-posts", "tracking_report-posts-and-play"].includes(
          name,
        )
      ) {
        const memberActions = page.getByRole("link", {
          name: /^(Read and reply|Open post)$/,
        });
        await expect(memberActions).toHaveCount(2);
        for (const action of await memberActions.all()) {
          await expect(action).toHaveAttribute(
            "href",
            /^https:\/\/elixir\.poapkings\.com\/home\/post\/[0-9]+(?:\?|$)/,
          );
          expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(
            44,
          );
        }
        await expect(
          page.getByText("Hog Rider · Musketeer", { exact: true }),
        ).toBeVisible();
      }
      if (name === "tracking_report-posts-and-play") {
        await expect(page.locator("body")).toContainText(
          "2 posts from 1 player · 23 battles from 1 player",
        );
        await expect(page.locator("body")).not.toContainText(
          "2 people you follow played",
        );
        await expect(page.locator("body")).not.toContainText(
          "No battles recorded",
        );
        for (const phrase of [
          "2 posts from 1 player",
          "23 battles from 1 player",
        ]) {
          const lines = await page.evaluate((text) => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walker.nextNode())) {
              const start = (node.textContent ?? "").indexOf(text);
              if (start < 0) continue;
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + text.length);
              return new Set(
                Array.from(range.getClientRects())
                  .filter((r) => r.width > 0)
                  .map((r) => Math.round(r.top)),
              ).size;
            }
            return 0;
          }, phrase);
          expect(lines, `${name}: ${phrase} stays together`).toBe(1);
        }
        await expect(
          page.getByRole("link", { name: /^Invented Ada/ }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /^Rapid Clear/ }),
        ).toBeVisible();
      }
      if (name === "tracking_report") {
        await expect(
          page.getByRole("img", { name: "Verified player", exact: true }),
        ).toHaveCount(2);
      }
      if (!message) {
        await expect(
          page.getByRole("link", { name: "Turn off this mail", exact: true }),
        ).toHaveAttribute("href", /unsubscribe\?t=preview$/);
        await expect(
          page.getByRole("link", { name: "Mail 000000", exact: true }),
        ).toHaveAttribute("href", /00000000-0000-4000-8000-000000000000/);
      }
    }
  });
}
