import { test, expect } from "@playwright/test";
import { renderRss } from "../../../services/web-api/src/feed-link.mjs";

const words = '<b>Keep these tags</b> &lt;literal entity&gt; & "words"';

for (const { label, item, title, description } of [
  {
    label: "authored words and card names",
    item: {
      id: "post_123",
      kind: "post",
      at: "2026-11-18T01:00:00.000Z",
      text: words,
      subjects: [],
      facts: {
        post_id: "123",
        question: true,
        cards: [{ name: words }],
        deck: null,
      },
    },
    title: words,
    description: `${words}\n\nCards: ${words}`,
  },
  {
    label: "tag-shaped game names",
    item: {
      id: "tl_123",
      kind: "name_changed",
      at: "2026-11-18T01:00:00.000Z",
      text: `${words} changed their name.`,
      subjects: [{ kind: "player", tag: "#0YRL2GQP", name: words }],
      facts: {},
    },
    title: `${words}: ${words} changed their name.`,
    description: `${words} changed their name.`,
  },
]) {
  test(`RSS preserves ${label} through XML and HTML parsing`, async ({
    page,
  }) => {
    const xml = renderRss([item]);
    const shown = await page.evaluate((feed) => {
      const parsed = new DOMParser().parseFromString(feed, "application/xml");
      const description = parsed.querySelector("item > description");
      const reader = document.createElement("div");
      reader.innerHTML = description?.textContent ?? "";
      return {
        xmlError: Boolean(parsed.querySelector("parsererror")),
        title: parsed.querySelector("item > title")?.textContent,
        text: reader.textContent,
        elements: reader.childElementCount,
      };
    }, xml);
    expect(shown).toEqual({
      xmlError: false,
      title,
      text: description,
      elements: 0,
    });
  });
}
