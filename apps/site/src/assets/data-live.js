/**
 * What moves on the Status and data page: Right now, and the chart's window.
 *
 * Right now is rendered server-side with the deploy-time numbers and still
 * reads true with JavaScript off: this only REPLACES values it successfully
 * fetched. A failed fetch leaves the baked answer standing and says so.
 *
 * External file, never inline: the CSP forbids inline script and a test
 * pins that.
 */
(function () {
  const chips = document.querySelector("[data-chart-range]");
  if (chips) {
    const buttons = chips.querySelectorAll("[data-range]");
    chips.hidden = false;
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        buttons.forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === button));
        });
        document.querySelectorAll("[data-chart]").forEach(function (chart) {
          chart.hidden = chart.dataset.chart !== button.dataset.range;
        });
      });
    });
  }

  const show = function (selector, on) {
    const el = document.querySelector(selector);
    if (el) el.hidden = !on;
  };
  const stale = function () {
    show('[data-live-line="stale"]', true);
  };

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s) || s < 0) return null;
    if (s < 90) return Math.round(s) + " sec ago";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }

  fetch("/api/public/status", { headers: { accept: "application/json" } })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (b) {
      if (!b || !b.health) {
        stale();
        return;
      }
      const behind = b.health.ok === false;
      show('[data-live-tag="ok"]', !behind);
      show('[data-live-tag="behind"]', behind);
      show('[data-live-line="behind"]', behind);
      const put = function (key, value) {
        if (value == null) return;
        const el = document.querySelector('[data-live="' + key + '"]');
        if (el) el.textContent = String(value);
      };
      if (typeof b.health.last_admission_seconds === "number")
        put(
          "last",
          ago(new Date(Date.now() - b.health.last_admission_seconds * 1000)),
        );
      put("hour", (b.health.battles_last_hour ?? 0).toLocaleString("en-US"));
      put("collectors", (b.collectors || []).length || null);
      // The headline the budget is held to: fetches in the last 24 hours
      // against the bulk share of the one global bucket.
      const bg = b.budget;
      if (bg && typeof bg.share_24h === "number")
        put("budget", Math.round(bg.share_24h * 100) + "%");
    })
    .catch(stale);
})();
