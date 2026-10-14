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
            manage:
              "https://elixir.poapkings.com/console/account/profile/email",
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
      if (!message) {
        await expect(
          page.getByRole("link", { name: /Turn off/ }),
        ).toHaveAttribute("href", /unsubscribe\?t=preview$/);
        await expect(
          page.getByRole("link", { name: "Email record", exact: true }),
        ).toHaveAttribute("href", /00000000-0000-4000-8000-000000000000/);
      }
    }
  });
}
