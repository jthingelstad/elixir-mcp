/**
 * The live half of the cards index (/cards, canvas 2026-09-29).
 *
 * The page is built with every card A to Z, each a link to its page, and
 * reads true with JavaScript off. This reads /api/public/cards once and
 * redraws that list as the board draws it: one mode at a time (modes are
 * different games and are never added together), most played first,
 * with search, sort, rarity and elixir filters, and each card's share of
 * decks, wins and battles in the mode. Every number on a tile is the
 * API's; nothing is estimated here.
 *
 * Without a season block (an older API, or nothing rolled up yet) the
 * list keeps its catalog facts and the controls that need no numbers:
 * search, rarity, elixir, and sort by name or cost. A failed fetch
 * leaves the built list standing.
 *
 * External file, never inline: the CSP forbids inline script.
 */
(function () {
  const root = document.querySelector("[data-cards-index]");
  if (!root) return;
  const grid = root.querySelector("[data-cards-grid]");
  const controls = root.querySelector("[data-cards-controls]");
  const modesBox = root.querySelector("[data-cards-modes]");
  const search = root.querySelector("[data-cards-search]");
  const sortSel = root.querySelector("[data-cards-sort]");
  const rarityBox = root.querySelector("[data-cards-rarity]");
  const elixirBox = root.querySelector("[data-cards-elixir]");
  const more = root.querySelector("[data-cards-more]");
  const legend = root.querySelector("[data-cards-legend]");
  const lede = root.querySelector("[data-cards-lede]");
  const updated = root.querySelector("[data-cards-updated]");

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
  if (!grid) return;

  /** The modes, in the order the board draws them. */
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
  const PAGE = 24;
  const THIN = 2000;

  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US"));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const formsLabel = (forms) =>
    (forms || [])
      .map((f) => (f === "evolution" ? "Evo" : f === "hero" ? "Hero" : null))
      .filter(Boolean)
      .join(" and ");

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

  const state = {
    mode: null,
    q: "",
    sort: "played",
    rarity: "",
    elixir: new Set(),
    all: false,
  };
  let cards = [];
  let season = null;

  function reading(card) {
    const byMode = season && season.cards ? season.cards[card.id] : null;
    return byMode && state.mode ? byMode[state.mode] || null : null;
  }

  /** Each card's place in the mode by share of decks: fixed for the
   *  mode, whatever the list is filtered or sorted by. */
  let rank = new Map();
  let top = 0;
  function rankMode() {
    rank = new Map();
    top = 0;
    if (!state.mode) return;
    const played = cards
      .map((c) => [c.id, reading(c)])
      .filter(([, r]) => r && r.usage_share != null)
      .sort((a, b) => b[1].usage_share - a[1].usage_share);
    played.forEach(([id], i) => rank.set(id, i + 1));
    top = played.length ? played[0][1].usage_share : 0;
  }

  function matches(c) {
    if (state.q && !c.name.toLowerCase().includes(state.q)) return false;
    if (state.rarity && c.rarity !== state.rarity) return false;
    if (state.elixir.size) {
      const key = c.elixir >= 7 ? "7+" : String(c.elixir);
      if (!state.elixir.has(key)) return false;
    }
    return true;
  }

  function ordered(list) {
    const byName = (a, b) => a.name.localeCompare(b.name, "en");
    const share = (c) => {
      const r = reading(c);
      return r && r.usage_share != null ? r.usage_share : -1;
    };
    if (state.sort === "name") return list.sort(byName);
    if (state.sort === "elixir")
      return list.sort(
        (a, b) => a.elixir - b.elixir || share(b) - share(a) || byName(a, b),
      );
    if (state.sort === "wins") {
      // A thin reading's rate is noise, so cards with 2,000 battles or
      // more lead and the thin ones follow, each by win rate.
      const key = (c) => {
        const r = reading(c);
        if (!r || r.win_rate == null) return [2, 0];
        return [r.battles < THIN ? 1 : 0, -r.win_rate];
      };
      return list.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || byName(a, b);
      });
    }
    return list.sort((a, b) => share(b) - share(a) || byName(a, b));
  }

  function tile(c) {
    const r = reading(c);
    const a = el("a", "card-tile");
    a.href = "/cards/" + c.id + "/" + (state.mode ? "?mode=" + state.mode : "");

    const art = el("span", "card-tile__art");
    const frame = el("span", "card-art");
    const inner = el("span", "card-art__frame");
    const img = el("img", "card-art__img");
    img.src = "/assets/cards/" + c.id + "-128.png";
    img.alt = "";
    img.width = 43;
    img.height = 63;
    img.loading = "lazy";
    img.setAttribute("data-name", c.name);
    inner.append(img);
    frame.append(inner);
    const drop = el("span", "card-elixir", String(c.elixir));
    drop.setAttribute("aria-label", c.elixir + " elixir");
    art.append(frame, drop);

    const body = el("span", "card-tile__body");
    const head = el("span", "card-tile__head");
    if (rank.has(c.id))
      head.append(el("span", "card-tile__rank", String(rank.get(c.id))));
    head.append(el("span", "card-tile__name", c.name));
    const forms = formsLabel(c.forms);
    body.append(
      head,
      el(
        "span",
        "card-tile__kind",
        cap(c.rarity) + " " + c.type + (forms ? " · " + forms : ""),
      ),
    );

    if (state.mode) {
      if (r && r.battles > 0) {
        const shareRow = el("span", "card-tile__share");
        const bar = el("span", "card-tile__bar");
        const fill = el("span", "card-tile__fill");
        if (top > 0 && r.usage_share != null)
          fill.style.width =
            Math.max(2, Math.round((r.usage_share / top) * 100)) + "%";
        bar.append(fill);
        bar.setAttribute("aria-hidden", "true");
        shareRow.append(bar, el("span", "card-tile__pct", pct(r.usage_share)));
        const line = el(
          "span",
          "card-tile__line",
          "wins " + pct(r.win_rate) + " · " + num(r.battles) + " battles ",
        );
        if (r.battles < THIN) line.append(el("span", "card-thin", "thin"));
        body.append(shareRow, line);
      } else {
        body.append(
          el(
            "span",
            "card-tile__line",
            "No " + LABEL[state.mode] + " battles yet this season",
          ),
        );
      }
    }
    a.append(art, body);
    const li = el("li");
    li.append(a);
    return li;
  }

  function draw() {
    const list = ordered(cards.filter(matches));
    const shown = state.all ? list : list.slice(0, PAGE);
    grid.replaceChildren(...shown.map(tile));
    if (!list.length) {
      const li = el(
        "li",
        "footnote",
        "No card matches. Clear the search or a filter to see more.",
      );
      grid.append(li);
    }
    if (more) {
      more.hidden = state.all || list.length <= PAGE;
      more.textContent = "Show all " + list.length + " cards";
    }
    if (legend) legend.hidden = !state.mode;
  }

  function setPressed(box, test) {
    for (const b of box.querySelectorAll("button"))
      b.setAttribute(
        "aria-pressed",
        test(b.getAttribute("data-value")) ? "true" : "false",
      );
  }

  function sayMode() {
    const m = season.modes.find((x) => x.mode_group === state.mode);
    if (lede && m)
      lede.textContent =
        "How every card is played across the " +
        num(m.decided_battles) +
        " " +
        LABEL[state.mode] +
        " battles Elixir recorded this season. Pick a mode to see another; modes are never added together.";
    setPressed(modesBox, (v) => v === state.mode);
  }

  function chooseMode(mode) {
    state.mode = mode;
    rankMode();
    sayMode();
    try {
      const u = new URL(location.href);
      u.searchParams.set("mode", mode);
      history.replaceState(null, "", u);
    } catch (e) {
      /* a page without history keeps working */
    }
    draw();
  }

  function wire() {
    controls.hidden = false;
    if (season && season.modes.length) {
      const have = new Set(season.modes.map((m) => m.mode_group));
      for (const [key, label] of MODES) {
        if (!have.has(key)) continue;
        const b = el("button", null, label);
        b.type = "button";
        b.setAttribute("data-value", key);
        b.addEventListener("click", () => chooseMode(key));
        modesBox.append(b);
      }
      const asked = new URLSearchParams(location.search).get("mode");
      // The season's modes come most-decided first.
      chooseMode(
        have.has(asked) && LABEL[asked]
          ? asked
          : season.modes.find((m) => LABEL[m.mode_group]).mode_group,
      );
      if (updated && season.as_of) {
        const text = ago(season.as_of);
        if (text) {
          updated.querySelector("[data-cards-updated-text]").textContent = text;
          updated.title =
            "Battles counted through " +
            new Date(season.as_of).toLocaleString();
          updated.hidden = false;
        }
      }
    } else {
      // No numbers to rank by: keep the catalog controls only.
      modesBox.hidden = true;
      for (const o of sortSel.querySelectorAll(
        'option[value="played"], option[value="wins"]',
      ))
        o.remove();
      state.sort = "name";
      sortSel.value = "name";
      draw();
    }

    search.addEventListener("input", () => {
      state.q = search.value.trim().toLowerCase();
      draw();
    });
    sortSel.addEventListener("change", () => {
      state.sort = sortSel.value;
      draw();
    });
    rarityBox.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.rarity = b.getAttribute("data-value") || "";
      setPressed(rarityBox, (v) => v === state.rarity);
      draw();
    });
    elixirBox.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const v = b.getAttribute("data-value");
      if (state.elixir.has(v)) state.elixir.delete(v);
      else state.elixir.add(v);
      setPressed(elixirBox, (x) => state.elixir.has(x));
      draw();
    });
    if (more)
      more.addEventListener("click", () => {
        state.all = true;
        draw();
      });
  }

  fetch("/api/public/cards", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (!body || !Array.isArray(body.cards)) return;
      cards = body.cards
        .filter((c) => c.elixirCost != null && c.iconUrls && c.iconUrls.medium)
        .map((c) => ({
          id: c.id,
          name: c.name,
          rarity: c.rarity || "",
          type: c.type || "",
          elixir: c.elixirCost,
          forms: c.forms_available || [],
        }));
      if (!cards.length) return;
      const s = body.season;
      season =
        s &&
        Array.isArray(s.modes) &&
        s.modes.some((m) => LABEL[m.mode_group]) &&
        s.cards
          ? s
          : null;
      wire();
    })
    .catch(() => {});
})();
