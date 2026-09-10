/**
 * The site rails (Docs, Examples, Data, Updates, Family).
 *
 * Two jobs, both progressive: below the one breakpoint the rail's head
 * row is a disclosure that opens the list in place — above the content,
 * never over it — and on Docs the search box narrows the rail to the
 * pages whose name or description matches, with "/" focusing it.
 * Without JavaScript the full list is in the page and every link works.
 *
 * External file, never inline: the CSP forbids inline script and a test
 * pins that.
 */
(function () {
  for (const rail of document.querySelectorAll("[data-siterail]")) {
    const head = rail.querySelector("[data-rail-toggle]");
    if (head) {
      head.addEventListener("click", () => {
        const open = rail.dataset.open !== "true";
        rail.dataset.open = open ? "true" : "false";
        head.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    const search = rail.querySelector("[data-docs-search]");
    if (search) {
      const items = [...rail.querySelectorAll("[data-search]")];
      const groups = [...rail.querySelectorAll(".rail__group")];
      const apply = () => {
        const q = search.value.trim().toLowerCase();
        for (const el of items)
          el.hidden = Boolean(q) && !el.dataset.search.includes(q);
        // A group heading with nothing left under it goes too.
        for (const g of groups) {
          let el = g.nextElementSibling;
          let any = false;
          while (el && !el.classList.contains("rail__group")) {
            if (el.matches("[data-search]") && !el.hidden) any = true;
            el = el.nextElementSibling;
          }
          g.hidden = !any;
        }
        // Searching opens the rail on a phone, or the matches are unseen.
        if (q) rail.dataset.open = "true";
      };
      search.addEventListener("input", apply);
      document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.target === search) return;
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        search.focus();
      });
    }
  }
})();
