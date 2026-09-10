/**
 * The top bar's narrow menu, on the static half.
 *
 * The app half does the same thing in React. Both render the same markup
 * at every width and let ONE media query decide which is showing, so the
 * two bars stay one bar — that is the handoff's stated build constraint,
 * and it is easy to break by teaching each half its own breakpoint.
 *
 * The Console button is deliberately not in here. It is the way into the
 * product, and burying it behind a menu costs a tap on the one thing
 * most people came for.
 *
 * Progressive enhancement: with the script off the button does nothing
 * and the six links are still reachable — they are in the sheet's markup,
 * and every one of them is also a real page a crawler can follow.
 */
(function () {
  const button = document.querySelector("[data-chrome-menu]");
  const sheet = document.getElementById("chrome-sheet");
  if (!button || !sheet) return;

  const openIcon = button.querySelector("[data-menu-open]");
  const closeIcon = button.querySelector("[data-menu-close]");

  function set(open) {
    sheet.dataset.open = open ? "true" : "false";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (openIcon) openIcon.hidden = open;
    if (closeIcon) closeIcon.hidden = !open;
  }

  button.addEventListener("click", function () {
    set(sheet.dataset.open !== "true");
  });

  // Escape closes it: a sheet you can only dismiss by finding the same
  // small button again is a trap on a phone.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") set(false);
  });

  // So is one that stays open when you tap the page behind it.
  document.addEventListener("click", function (e) {
    if (sheet.dataset.open !== "true") return;
    if (!sheet.contains(e.target) && !button.contains(e.target)) set(false);
  });
})();
