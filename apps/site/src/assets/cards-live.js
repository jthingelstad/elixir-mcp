/**
 * The live half of a card page.
 *
 * The catalog facts are rendered server-side and read true with
 * JavaScript off; this only FILLS the season numbers, which move with
 * the nightly rollup and would be stale if they were baked. A failed
 * fetch leaves the em dashes standing rather than blanking the page and
 * explaining nothing - the same stance as data-live.js.
 *
 * External file, never inline: the CSP forbids inline script.
 */
(function () {
  const root = document.querySelector("[data-card]");
  if (!root) return;
  const id = root.getAttribute("data-card");
  const pct = function (v) {
    return v == null ? "—" : (v * 100).toFixed(1) + "%";
  };
  const num = function (v) {
    return v == null ? "—" : Number(v).toLocaleString("en-US");
  };
  const put = function (key, html) {
    const el = document.querySelector('[data-card-live="' + key + '"]');
    if (el) el.innerHTML = html;
  };
  const table = function (head, rows) {
    if (!rows.length)
      return '<p class="footnote" style="margin:0">Nothing recorded yet.</p>';
    return (
      '<table class="table"><thead><tr>' +
      head
        .map(function (h) {
          return "<th>" + h + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      rows
        .map(function (r) {
          return (
            "<tr>" +
            r
              .map(function (c) {
                return "<td>" + c + "</td>";
              })
              .join("") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>"
    );
  };
  const MODES = {
    ranked: "Ranked (Path of Legends)",
    ladder: "Trophy Road",
    casual: "Casual",
    war: "War",
    tournament: "Tournament",
    challenge: "Challenge",
  };
  fetch("/api/public/cards/" + encodeURIComponent(id), {
    headers: { accept: "application/json" },
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (b) {
      if (!b) return;
      const now =
        b.history && b.history.length ? b.history[b.history.length - 1] : null;
      if (now) {
        put("usage", pct(now.usage_share));
        put("players", num(now.players));
        put("win", pct(now.win_rate));
      }
      put(
        "history",
        table(
          ["Season", "Usage", "Win rate", "Battles"],
          (b.history || []).map(function (h) {
            return [
              h.season_month,
              pct(h.usage_share),
              pct(h.win_rate),
              num(h.battles),
            ];
          }),
        ),
      );
      put(
        "modes",
        table(
          ["Mode", "Usage", "Win rate", "Battles"],
          (b.by_mode || []).map(function (m) {
            return [
              MODES[m.mode_group] || m.mode_group,
              pct(m.usage_share),
              pct(m.win_rate),
              num(m.battles) + (m.battles < 2000 ? " (thin)" : ""),
            ];
          }),
        ),
      );
      if (b.issue) {
        const panel = document.querySelector('[data-card-live="issue"]');
        if (panel) panel.hidden = false;
        put(
          "issue-line",
          "This card was the Card of the Week in " +
            b.issue.period_key +
            (b.issue.subject ? ": “" + b.issue.subject + "”" : "") +
            ".",
        );
      }
    })
    .catch(function () {});
})();
