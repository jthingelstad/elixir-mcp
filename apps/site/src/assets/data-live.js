/**
 * The one live element on the Data page.
 *
 * The strip is rendered server-side with the deploy-time numbers and
 * still reads true with JavaScript off — this only REPLACES values it
 * successfully fetched. A failed fetch leaves the baked answer standing
 * rather than blanking three numbers and explaining nothing.
 *
 * External file, never inline: the CSP forbids inline script and a test
 * pins that.
 */
(function () {
  const slots = document.querySelectorAll("[data-live]");
  if (slots.length === 0) return;

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s) || s < 0) return null;
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  fetch("/api/public/status", { headers: { accept: "application/json" } })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (b) {
      if (!b || !b.health) return;
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
    })
    .catch(function () {
      /* keep the baked values */
    });
})();
