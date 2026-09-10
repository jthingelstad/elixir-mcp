/**
 * A page rail whose items are anchors on the same document (Data): mark
 * the section the reader is in as they scroll, the way the console rail
 * marks its current item. Without JavaScript the links still jump.
 *
 * External file, never inline: the CSP forbids inline script and a test
 * pins that.
 */
(function () {
  const rail = document.querySelector("[data-rail-anchors]");
  if (!rail || !("IntersectionObserver" in window)) return;
  const items = [...rail.querySelectorAll('a[href^="#"]')];
  const targets = items
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);
  if (targets.length === 0) return;

  const here = rail.querySelector("[data-rail-here]");
  function mark(id) {
    for (const a of items) {
      const on = a.getAttribute("href") === "#" + id;
      // A rail item takes the rail's gold rule; an outline link (the
      // docs' "On this page") is marked by aria-current alone.
      if (a.classList.contains("rail__item"))
        a.classList.toggle("rail__item--on", on);
      if (on) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
      // The head row names where you are, the way the console rail does.
      if (on && here) here.textContent = a.textContent.trim();
    }
  }

  // The topmost section whose top has passed the upper third of the
  // viewport is the one being read.
  const seen = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const current = targets.find((t) => seen.get(t.id));
      if (current) mark(current.id);
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
  );
  for (const t of targets) io.observe(t);
  mark(targets[0].id);
})();
