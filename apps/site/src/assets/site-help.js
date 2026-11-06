/**
 * Help on a static page: opens the drawer in base.njk and files a note with
 * the page riding along, through the same route as the app's drawer
 * (apps/web/src/shell/HelpDrawer.jsx). Only a signed-in face can reach it.
 *
 * External file, never inline: the CSP forbids inline script and a test pins
 * that.
 */
(function () {
  const box = document.querySelector("[data-help]");
  if (!box) return;
  const form = box.querySelector("[data-help-form]");
  const note = box.querySelector("[data-help-note]");
  const send = box.querySelector("[data-help-send]");
  const done = box.querySelector("[data-help-done]");
  const error = box.querySelector("[data-help-error]");

  for (const el of document.querySelectorAll("[data-help-open]"))
    el.addEventListener("click", () => box.showModal());
  box
    .querySelector("[data-help-close]")
    .addEventListener("click", () => box.close());

  note.addEventListener("input", () => {
    send.disabled = !note.value.trim();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = note.value.trim();
    if (!message || send.disabled) return;
    send.disabled = true;
    error.hidden = true;
    let ok = false;
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-elixir-client": "web",
        },
        body: JSON.stringify({
          message,
          category: "general",
          area: "console",
          context: {
            path: window.location.pathname,
            page: form.dataset.page,
          },
        }),
      });
      ok = r.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      done.hidden = false;
      note.hidden = true;
      send.hidden = true;
    } else {
      error.textContent =
        "That did not send. Your note is still here; try again in a moment.";
      error.hidden = false;
      send.disabled = false;
    }
  });
})();
