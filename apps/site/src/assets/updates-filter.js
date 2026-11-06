/**
 * The Updates switch: contract versions stay out of the stream until asked for.
 * The choice is kept in the URL (?contracts=1, so it can be sent to someone) and
 * in this browser. Also sends an old /updates#YYYY-MM anchor to its month's page.
 *
 * External file, never inline: the CSP forbids inline script and a test pins
 * that.
 */
(function () {
  const KEY = "elixir.updates.contracts";
  const wrap = document.querySelector("[data-contract-switch]");
  if (!wrap) return;

  // Old month anchors: the month is a page now.
  const anchor = /^#(\d{4}-\d{2})$/.exec(location.hash);
  if (anchor && !document.getElementById(anchor[1])) {
    location.replace("/updates/" + anchor[1]);
    return;
  }

  const input = wrap.querySelector("input");
  const remembered = function () {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  };
  const params = new URLSearchParams(location.search);
  const start = params.has("contracts")
    ? params.get("contracts") === "1"
    : remembered();

  function apply(on) {
    input.checked = on;
    document.querySelectorAll('article[data-kind="contract"]').forEach((e) => {
      e.hidden = !on;
    });
    document.querySelectorAll("[data-only-contracts]").forEach((e) => {
      e.hidden = on;
    });
    document.querySelectorAll("[data-count-all]").forEach((e) => {
      e.textContent = on ? e.dataset.countAll : e.dataset.countProduct;
    });
    // Month and pager links carry the choice with them.
    document
      .querySelectorAll("[data-month-link], .updates-pager a")
      .forEach((a) => {
        const url = new URL(a.href);
        if (on) url.searchParams.set("contracts", "1");
        else url.searchParams.delete("contracts");
        a.href = url.pathname + url.search;
      });
  }

  wrap.hidden = false;
  apply(start);
  input.addEventListener("change", () => {
    const url = new URL(location.href);
    if (input.checked) url.searchParams.set("contracts", "1");
    else url.searchParams.delete("contracts");
    history.replaceState(null, "", url);
    try {
      localStorage.setItem(KEY, input.checked ? "1" : "0");
    } catch {
      /* the URL still holds it */
    }
    apply(input.checked);
  });
})();
