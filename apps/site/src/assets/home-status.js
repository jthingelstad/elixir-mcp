/**
 * The front page's "Recording now" tag says what /api/public/status says: when
 * health is ok the tag shows, and otherwise it stays away rather than claim it.
 * One fetch; a failed one shows nothing.
 *
 * External file, never inline: the CSP forbids inline script.
 */
(function () {
  const tag = document.querySelector("[data-recording-now]");
  if (!tag) return;
  fetch("/api/public/status", { headers: { accept: "application/json" } })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (b) {
      if (b && b.health && b.health.ok !== false) tag.hidden = false;
    })
    .catch(function () {});
})();
