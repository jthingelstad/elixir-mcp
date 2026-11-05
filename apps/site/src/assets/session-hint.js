/**
 * Which face a static page shows, decided before it paints.
 *
 * Loaded as a blocking script in <head> so nothing on the page swaps after
 * load. The app writes the hint (apps/web/src/lib/session-hint.js); both
 * faces are in the markup, marked `data-session-face`, and the stylesheet
 * shows one of them from the attribute set here. With the script or storage
 * off, the page keeps its signed-out face.
 *
 * The name reaches the bar as CSS custom properties, read by `content`, so
 * nothing in the page has to exist yet.
 */
(function () {
  try {
    const hint = JSON.parse(window.localStorage.getItem("elixir.session"));
    if (!hint || !(hint.until > Date.now())) return;
    const root = document.documentElement;
    root.setAttribute("data-session", "in");
    if (typeof hint.name !== "string" || !hint.name) return;
    const words = hint.name.trim().split(/\s+/).filter(Boolean);
    const initials =
      words.length > 1
        ? words.slice(0, 2).map((w) => Array.from(w)[0])
        : Array.from(words[0] ?? "").slice(0, 2);
    root.style.setProperty("--session-name", JSON.stringify(hint.name));
    root.style.setProperty(
      "--session-initials",
      JSON.stringify(initials.join("").toUpperCase()),
    );
  } catch {
    // A hint that cannot be read is no hint.
  }
})();
