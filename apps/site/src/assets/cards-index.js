/** Catalog browsing and art fallback. No game-wide statistics are requested. */
(function () {
  document.addEventListener(
    "error",
    function (event) {
      const img = event.target;
      if (!img?.classList?.contains("card-art__img")) return;
      const blank = document.createElement("span");
      blank.className = "card-art__blank";
      blank.textContent = img.getAttribute("data-name") || "";
      img.replaceWith(blank);
    },
    true,
  );
  const root = document.querySelector("[data-cards-index]");
  const grid = root?.querySelector("[data-cards-grid]");
  if (!grid) return;
  const cards = [...grid.children];
  const search = root.querySelector("[data-cards-search]");
  const sort = root.querySelector("[data-cards-sort]");
  const rarity = root.querySelector("[data-cards-rarity]");
  const elixir = root.querySelector("[data-cards-elixir]");
  const costs = new Set();
  let selectedRarity = "";
  sort.value = "name";
  function draw() {
    const query = search.value.trim().toLowerCase();
    cards.sort(
      (a, b) =>
        (sort.value === "elixir"
          ? Number(a.dataset.elixir) - Number(b.dataset.elixir)
          : 0) || a.dataset.name.localeCompare(b.dataset.name),
    );
    for (const card of cards) {
      const cost = Number(card.dataset.elixir);
      card.hidden = !(
        card.dataset.name.toLowerCase().includes(query) &&
        (!selectedRarity || card.dataset.rarity === selectedRarity) &&
        (!costs.size || costs.has(cost >= 7 ? "7+" : String(cost)))
      );
      grid.append(card);
    }
  }
  search.addEventListener("input", draw);
  sort.addEventListener("change", draw);
  rarity.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    selectedRarity = button.dataset.value;
    for (const child of rarity.querySelectorAll("button"))
      child.setAttribute("aria-pressed", String(child === button));
    draw();
  });
  elixir.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    const value = button.dataset.value;
    if (costs.has(value)) costs.delete(value);
    else costs.add(value);
    button.setAttribute("aria-pressed", String(costs.has(value)));
    draw();
  });
  root.querySelector("[data-cards-controls]").hidden = false;
  draw();
})();
