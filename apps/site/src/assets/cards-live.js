/**
 * The live half of a card page (/cards/<id>, canvas 2026-09-29).
 *
 * The catalog facts are rendered server-side and read true with
 * JavaScript off; this FILLS the season's numbers from
 * /api/public/cards/<id>, which the hourly rollup moves and which would
 * be stale if they were baked. One mode at a time: the mode switch, the
 * four figures and the By mode table's marked row all follow one mode,
 * because modes are different games and are never added together. The
 * months are every mode together (the only history the record keeps),
 * and the page says so.
 *
 * The "most played" chip reads the cards index's endpoint as well, for
 * the card's place in the mode. If that read fails the chip stays
 * hidden; if the card's own read fails the dashes stay standing.
 *
 * External file, never inline: the CSP forbids inline script.
 */
(function () {
  const root = document.querySelector("[data-card]");
  if (!root) return;
  const id = root.getAttribute("data-card");
  const $ = (sel) => root.querySelector(sel);
  const live = (key) => $('[data-card-live="' + key + '"]');

  // Art that failed to load becomes the kit's blank frame with the
  // card's name, not a broken image. Capture: error does not bubble.
  root.addEventListener(
    "error",
    function (e) {
      const img = e.target;
      if (!img || !img.classList || !img.classList.contains("card-art__img"))
        return;
      const blank = document.createElement("span");
      blank.className = "card-art__blank";
      blank.textContent = img.getAttribute("data-name") || "";
      img.replaceWith(blank);
    },
    true,
  );

  const MODES = [
    ["ranked", "Path of Legends"],
    ["ladder", "Trophy Road"],
    ["war", "War"],
    ["tournament", "Tournament"],
    ["casual", "Casual"],
    ["challenge", "Challenge"],
    ["event", "Events"],
  ];
  const LABEL = Object.fromEntries(MODES);
  const ORDER = MODES.map((m) => m[0]);
  const THIN = 2000;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US"));
  const set = (key, text) => {
    const n = live(key);
    if (n) n.textContent = text;
  };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ordinal(n) {
    const t = n % 100;
    const s =
      t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
    return n + s;
  }
  function ago(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 60)
      return "updated " + (min <= 1 ? "just now" : min + " minutes ago");
    const h = Math.round(min / 60);
    if (h < 24)
      return "updated " + (h === 1 ? "an hour ago" : h + " hours ago");
    const d = Math.round(h / 24);
    return "updated " + (d === 1 ? "a day ago" : d + " days ago");
  }
  function showChip(sel, on) {
    const chip = $(sel);
    if (chip) chip.hidden = !on;
    const row = $("[data-card-chips]");
    if (row)
      row.hidden = !root.querySelector("[data-card-chips] > :not([hidden])");
  }

  let byMode = new Map();
  let catalogSeason = null;
  let season = null;

  /** The card's place among every card in the mode, by share of decks,
   *  from the index's endpoint for the same season. */
  function placeIn(mode) {
    if (!catalogSeason || catalogSeason.season_month !== season) return null;
    const mine = (catalogSeason.cards[id] || {})[mode];
    if (!mine || mine.usage_share == null) return null;
    let above = 0;
    for (const k in catalogSeason.cards) {
      const r = catalogSeason.cards[k][mode];
      if (r && r.usage_share != null && r.usage_share > mine.usage_share)
        above += 1;
    }
    return above + 1;
  }

  function choose(mode) {
    const r = byMode.get(mode);
    const thin = r.battles < THIN;
    set("share", pct(r.usage_share));
    set(
      "share-note",
      "of " + num(r.decided_battles) + " " + LABEL[mode] + " battles",
    );
    set("wins", pct(r.win_rate));
    set("wins-note", "when it was in the deck" + (thin ? " · thin" : ""));
    set("battles", num(r.battles));
    set("players", num(r.players));
    set("agent-mode", mode);
    for (const b of $("[data-card-modes]").querySelectorAll("button"))
      b.setAttribute(
        "aria-pressed",
        b.getAttribute("data-value") === mode ? "true" : "false",
      );
    for (const tr of live("modes").querySelectorAll("tr[data-mode]"))
      tr.setAttribute(
        "aria-current",
        tr.getAttribute("data-mode") === mode ? "true" : "false",
      );
    const place = placeIn(mode);
    const rank = $("[data-card-rank]");
    if (rank && place) {
      rank.textContent =
        (place === 1 ? "most played" : ordinal(place) + " most played") +
        " in " +
        LABEL[mode] +
        " this season";
    }
    showChip("[data-card-rank]", Boolean(place));
    const crumb = $("[data-card-crumb]");
    if (crumb) crumb.href = "/cards/?mode=" + mode;
    try {
      const u = new URL(location.href);
      u.searchParams.set("mode", mode);
      history.replaceState(null, "", u);
    } catch (e) {
      /* a page without history keeps working */
    }
  }

  function drawModes(modes) {
    const body = live("modes");
    body.replaceChildren();
    if (!modes.length) {
      const tr = el("tr");
      const td = el(
        "td",
        "text-ink-faint",
        "No battles with this card are recorded this season.",
      );
      td.colSpan = 4;
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const m of modes) {
      const tr = el("tr", "card-mode-row");
      tr.setAttribute("data-mode", m.mode_group);
      const thin = m.battles < THIN;
      const wins = el("td", "text-right font-mono");
      wins.append(el("span", thin ? "card-thin-rate" : null, pct(m.win_rate)));
      if (thin) {
        wins.append(" ");
        wins.append(el("span", "card-thin", "thin"));
      }
      tr.append(
        el("td", null, LABEL[m.mode_group]),
        el("td", "text-right font-mono", num(m.battles)),
        el("td", "text-right font-mono", pct(m.usage_share)),
        wins,
      );
      body.append(tr);
    }
    const box = $("[data-card-modes]");
    for (const m of modes) {
      const b = el("button", null, LABEL[m.mode_group]);
      b.type = "button";
      b.setAttribute("data-value", m.mode_group);
      b.addEventListener("click", () => choose(m.mode_group));
      box.append(b);
    }
    box.hidden = false;
  }

  function drawMonths(history) {
    const box = live("months");
    box.replaceChildren();
    if (!history.length) {
      box.append(
        el("p", "footnote m-0", "No month of this card is recorded yet."),
      );
      return;
    }
    const years = new Set(
      history.map((h) => String(h.season_month).slice(0, 4)),
    );
    const top = Math.max(...history.map((h) => h.usage_share || 0));
    const words = [];
    for (const h of history) {
      const [y, m] = String(h.season_month).split("-");
      const label =
        (MONTHS[Number(m) - 1] || h.season_month) +
        (years.size > 1 ? " ’" + y.slice(2) : "");
      const col = el("div", "card-months__col");
      const track = el("div", "card-months__track");
      const bar = el("span", "card-months__bar");
      if (top > 0 && h.usage_share != null)
        bar.style.height =
          Math.max(2, Math.round((h.usage_share / top) * 164)) + "px";
      track.append(bar);
      col.append(
        el("span", "card-months__pct", pct(h.usage_share)),
        track,
        el("span", "card-months__label", label),
        el("span", "card-months__wins", "wins " + pct(h.win_rate)),
      );
      box.append(col);
      words.push(label + " " + pct(h.usage_share));
    }
    box.setAttribute("role", "img");
    box.setAttribute(
      "aria-label",
      "Share of decks by month, every mode together: " + words.join(", "),
    );
  }

  function drawIssue(issue, name) {
    if (!issue) return;
    const when = issue.sent_at ? new Date(issue.sent_at) : null;
    const day =
      when && Number.isFinite(when.getTime())
        ? MONTHS[when.getUTCMonth()] + " " + when.getUTCDate()
        : issue.period_key;
    const text = $("[data-card-issue-text]");
    if (text) text.textContent = "Card of the Week, " + day;
    showChip("[data-card-issue]", true);
    const line = live("issue-line");
    if (!line) return;
    line.replaceChildren();
    line.append(
      el("b", "text-ink", name + " was the Card of the Week on " + day + "."),
    );
    if (issue.subject) line.append(" The issue was “" + issue.subject + "”.");
    line.append(
      " Every Friday a program draws one card from the season’s ten most played, and the email links here.",
    );
  }

  const one = fetch("/api/public/cards/" + encodeURIComponent(id), {
    headers: { accept: "application/json" },
  }).then((r) => (r.ok ? r.json() : null));
  const all = fetch("/api/public/cards", {
    headers: { accept: "application/json" },
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  Promise.all([one, all])
    .then(([b, index]) => {
      if (!b) throw new Error("no card");
      season = b.season;
      catalogSeason =
        index && index.season && index.season.cards ? index.season : null;
      const modes = (b.by_mode || [])
        .filter((m) => LABEL[m.mode_group])
        .sort(
          (x, y) => ORDER.indexOf(x.mode_group) - ORDER.indexOf(y.mode_group),
        );
      byMode = new Map(modes.map((m) => [m.mode_group, m]));
      drawModes(modes);
      drawMonths(b.history || []);
      drawIssue(b.issue, (b.card && b.card.name) || "This card");
      if (b.as_of) {
        const text = ago(b.as_of);
        const chip = $("[data-card-updated]");
        if (text && chip) {
          $("[data-card-updated-text]").textContent = text;
          chip.title =
            "Battles counted through " + new Date(b.as_of).toLocaleString();
          chip.hidden = false;
        }
      }
      if (modes.length) {
        const asked = new URLSearchParams(location.search).get("mode");
        // The server lists the card's modes most battles first.
        const first = (b.by_mode || []).find(
          (m) => LABEL[m.mode_group],
        ).mode_group;
        choose(byMode.has(asked) ? asked : first);
      }
    })
    .catch(() => {
      const months = live("months");
      if (months)
        months.replaceChildren(
          el("p", "footnote m-0", "The record could not be read just now."),
        );
      const modes = live("modes");
      if (modes) {
        const tr = el("tr");
        const td = el(
          "td",
          "text-ink-faint",
          "The record could not be read just now.",
        );
        td.colSpan = 4;
        tr.append(td);
        modes.replaceChildren(tr);
      }
    });
})();
