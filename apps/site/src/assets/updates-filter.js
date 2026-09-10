/**
 * The Updates rail's kind filter. Narrows the entries in place and
 * renames the title ("Updates · Shipped") so the page says what it is
 * showing. Progressive enhancement: without this every entry shows and
 * the archive links still jump.
 *
 * External file, never inline: the CSP forbids inline script and a test
 * pins that.
 */
(function () {
  const rail = document.querySelector("[data-updates-rail]");
  if (!rail) return;
  const buttons = [...rail.querySelectorAll("[data-kind]")];
  const entries = [...document.querySelectorAll("article[data-kind]")];
  const title = document.querySelector("[data-updates-title]");
  const months = [...document.querySelectorAll("h2[id]")];

  function pick(kind) {
    for (const b of buttons) {
      const on = b.dataset.kind === kind;
      b.classList.toggle("rail__item--on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const e of entries)
      e.hidden = kind !== "all" && e.dataset.kind !== kind;
    // A month with nothing left in it hides with its entries.
    for (const h of months) {
      let el = h.nextElementSibling;
      let any = false;
      while (el && el.tagName !== "H2") {
        if (el.tagName === "ARTICLE" && !el.hidden) any = true;
        el = el.nextElementSibling;
      }
      h.hidden = !any;
    }
    if (title) {
      const label = buttons
        .find((b) => b.dataset.kind === kind)
        ?.firstChild?.textContent?.trim();
      title.textContent =
        kind === "all" ? "Updates" : "Updates · " + (label ?? kind);
    }
  }

  for (const b of buttons)
    b.addEventListener("click", () => pick(b.dataset.kind));
})();
