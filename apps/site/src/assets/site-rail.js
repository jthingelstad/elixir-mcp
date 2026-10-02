/**
 * The site rails (Docs, Examples, Data, Updates, Family).
 *
 * Two jobs, both progressive: below the one breakpoint the rail's head
 * row is a disclosure that opens the list in place — above the content,
 * never over it — and on Docs the search box narrows the rail to the
 * pages whose name or description matches, opening the groups that
 * hold them, with "/" focusing it.
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
      // The docs' groups are disclosures, one open; a search opens every
      // group with a match and hides the rest, and clearing it puts back
      // the groups as they were.
      const groups = [...rail.querySelectorAll("[data-docs-group]")].map(
        (el) => ({ el, open: el.open }),
      );
      const apply = () => {
        const q = search.value.trim().toLowerCase();
        for (const el of items)
          el.hidden = Boolean(q) && !el.dataset.search.includes(q);
        for (const g of groups) {
          const any = [...g.el.querySelectorAll("[data-search]")].some(
            (el) => !el.hidden,
          );
          g.el.hidden = Boolean(q) && !any;
          g.el.open = q ? any : g.open;
        }
        // Searching opens the rail on a phone, or the matches are unseen.
        if (q) rail.dataset.open = "true";
      };
      // A group opened or closed by hand is how it stays when the
      // search is cleared.
      for (const g of groups)
        g.el.addEventListener("toggle", () => {
          if (!search.value.trim()) g.open = g.el.open;
        });
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
