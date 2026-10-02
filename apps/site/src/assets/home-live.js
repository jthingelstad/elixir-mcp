/**
 * The live half of the front door: the Cards tile's three and the
 * strip of the ten most played cards in Path of Legends this season.
 *
 * Both read /api/public/cards once, the same body the cards index
 * reads, and draw only what it returns: each card's share of decks and
 * wins in the one mode (modes are never added together), and the mode's
 * own count of recorded battles. Without a season block, or without
 * Path of Legends in it, both stay hidden; the page reads whole without
 * them, and a failed fetch leaves nothing half drawn.
 *
 * External file, never inline: the CSP forbids inline script.
 */
(function () {
  const root = document.querySelector("[data-home]");
  if (!root) return;
  const MODE = "ranked";
  const MODE_LABEL = "Path of Legends";
  const STRIP = 10;
  const THIN = 2000;
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const pct = (v) => (v * 100).toFixed(1) + "%";
  const num = (v) => Number(v).toLocaleString("en-US");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** "updated 3 hours ago", from the rollup's battle cursor. */
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

  /** The card's art with its elixir drop; a failed image becomes the
   *  kit's blank frame with the name, never a broken image. */
  function art(card, cls) {
    const box = el("span", cls);
    const frame = el("span", "card-art");
    const inner = el("span", "card-art__frame");
    const img = el("img", "card-art__img");
    img.src = "/assets/cards/" + card.id + "-128.png";
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", function () {
      img.replaceWith(el("span", "card-art__blank", card.name));
    });
    inner.append(img);
    frame.append(inner);
    const drop = el("span", "card-elixir", String(card.elixirCost));
    drop.setAttribute("aria-label", card.elixirCost + " elixir");
    box.append(frame, drop);
    return box;
  }

  function href(card) {
    return "/cards/" + card.id + "/?mode=" + MODE;
  }

  function draw(body) {
    const season = body.season;
    if (!season || !season.cards || !Array.isArray(season.modes)) return;
    const mode = season.modes.find((m) => m.mode_group === MODE);
    if (!mode || !mode.decided_battles) return;
    const played = body.cards
      .filter((c) => c && c.elixirCost != null)
      .map((c) => [c, (season.cards[c.id] || {})[MODE]])
      .filter(([, r]) => r && r.battles > 0 && r.usage_share != null)
      .sort((a, b) => b[1].usage_share - a[1].usage_share);
    if (!played.length) return;
    const top = played[0][1].usage_share;
    const month = /^\d{4}-(\d{2})$/.exec(season.season_month || "");

    const tile = root.querySelector("[data-home-top3]");
    const list = root.querySelector("[data-home-top3-list]");
    const caption = root.querySelector("[data-home-top3-caption]");
    if (tile && list) {
      list.replaceChildren(
        ...played.slice(0, 3).map(([c, r]) => {
          const li = el("li", "home-tile__row gap-2.5");
          const text = el("span", "home-top3__body");
          const line = el("span", "home-top3__line");
          line.append(el("span", null, c.name));
          line.append(el("span", "home-top3__pct", pct(r.usage_share)));
          const bar = el("span", "card-tile__bar");
          bar.setAttribute("aria-hidden", "true");
          const fill = el("span", "card-tile__fill");
          fill.style.width =
            Math.max(2, Math.round((r.usage_share / top) * 100)) + "%";
          bar.append(fill);
          text.append(line, bar);
          li.append(art(c, "home-top3__art"), text);
          return li;
        }),
      );
      if (caption)
        caption.textContent =
          "share of " +
          MODE_LABEL +
          " decks" +
          (month ? ", " + MONTHS[Number(month[1]) - 1] : " this season");
      tile.hidden = false;
    }

    const strip = root.querySelector("[data-home-strip]");
    const row = root.querySelector("[data-home-strip-list]");
    const note = root.querySelector("[data-home-strip-note]");
    if (strip && row) {
      row.replaceChildren(
        ...played.slice(0, STRIP).map(([c, r]) => {
          const li = el("li", "home-strip__item");
          const a = el("a", "home-strip__card");
          a.href = href(c);
          a.append(
            art(c, "home-strip__art"),
            el("span", "home-strip__name", c.name),
          );
          li.append(
            a,
            el("span", "home-strip__pct", pct(r.usage_share)),
            el(
              "span",
              "home-strip__wins",
              r.win_rate == null
                ? r.battles < THIN
                  ? "thin"
                  : ""
                : "wins " +
                    pct(r.win_rate) +
                    (r.battles < THIN ? " · thin" : ""),
            ),
          );
          return li;
        }),
      );
      if (note) {
        const when = ago(season.as_of);
        note.textContent =
          "share of decks across " +
          num(mode.decided_battles) +
          " recorded battles" +
          (when ? " · " + when : "");
      }
      strip.hidden = false;
    }
  }

  fetch("/api/public/cards", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (body && Array.isArray(body.cards)) draw(body);
    })
    .catch(() => {});
})();
