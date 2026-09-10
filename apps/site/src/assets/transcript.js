/**
 * The home page's typing transcript.
 *
 * Progressive enhancement, and it matters here more than anywhere else
 * on the site: the whole exchange is in the HTML already, fully readable
 * with JavaScript off or before this file arrives. This only takes the
 * finished text away and types it back in. A visitor who never runs it
 * sees the same conversation, just without the theatre.
 *
 * ONE interval drives everything, with a hold counter for the pauses,
 * because three timers chasing each other is how a typing effect ends up
 * printing two characters into the wrong bubble. State lives in this
 * closure so a re-render cannot restart it mid-sentence.
 *
 * The window is a fixed height with justify-content:flex-end, so a long
 * answer pushes older messages up and out rather than growing the box
 * and shoving the rest of the page down the screen as you read it.
 */
(function () {
  const root = document.querySelector("[data-transcript]");
  if (!root) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const scripts = new Map();
  for (const pane of root.querySelectorAll("[data-script]"))
    scripts.set(pane.dataset.script, pane);

  const chips = [...root.querySelectorAll("[data-topic]")];
  const stage = root.querySelector("[data-stage]");
  const thinking = root.querySelector("[data-thinking]");
  const toolbar = root.querySelector("[data-tools]");
  if (!stage || chips.length === 0) return;

  // Every line of every script, read out of the markup that already
  // renders them, so the copy lives in one place.
  const read = (key) =>
    [...scripts.get(key).querySelectorAll("[data-line]")].map((el) => ({
      role: el.dataset.line,
      text: el.querySelector("[data-text]").textContent.trim(),
      cite: el.querySelector("[data-cite]")?.textContent.trim() ?? null,
    }));

  let key = chips[0].dataset.topic;
  let lines = read(key);
  let at = 0; // which line
  let ch = 0; // how far into it
  let hold = 0; // ticks to wait before doing anything else
  let stopped = false;

  function bubble(line) {
    const wrap = document.createElement("div");
    wrap.className =
      line.role === "user" ? "transcript__user" : "transcript__agent";
    const text = document.createElement("span");
    text.className = "transcript__text";
    wrap.appendChild(text);
    if (line.cite) {
      const cite = document.createElement("span");
      cite.className = "transcript__cite";
      cite.textContent = line.cite;
      cite.hidden = true;
      wrap.appendChild(cite);
    }
    stage.appendChild(wrap);
    return wrap;
  }

  let current = null;
  function reset(next) {
    key = next;
    lines = read(key);
    at = 0;
    ch = 0;
    hold = 0;
    current = null;
    stage.replaceChildren();
    thinking.hidden = true;
    for (const chip of chips)
      chip.setAttribute("aria-pressed", chip.dataset.topic === key);
    if (toolbar) toolbar.dataset.for = key;
    for (const set of toolbar?.querySelectorAll("[data-tools-for]") ?? [])
      set.hidden = set.dataset.toolsFor !== key;
  }

  const TICK = 18; // ms between characters
  function step() {
    if (stopped) return;
    if (hold > 0) {
      hold -= 1;
      return;
    }
    if (at >= lines.length) {
      // Hold the finished conversation, then start the next topic — so a
      // visitor who leaves the tab open sees all three rather than one.
      hold = 220;
      const next =
        chips[
          (chips.findIndex((c) => c.dataset.topic === key) + 1) % chips.length
        ];
      reset(next.dataset.topic);
      return;
    }
    const line = lines[at];
    if (!current) {
      if (line.role === "agent" && ch === 0) {
        // The thinking beat: the answer is not instant, and pretending
        // it is would be the one dishonest frame in the whole thing.
        thinking.hidden = false;
        hold = 30;
        ch = 1;
        return;
      }
      thinking.hidden = true;
      current = bubble(line);
      ch = 0;
    }
    const text = current.querySelector(".transcript__text");
    ch += 1;
    text.textContent = line.text.slice(0, ch);
    if (ch >= line.text.length) {
      const cite = current.querySelector(".transcript__cite");
      if (cite) cite.hidden = false;
      current = null;
      at += 1;
      ch = 0;
      hold = line.role === "user" ? 14 : 90;
    }
  }

  // The scripts are in the DOM for a reader without JavaScript; once we
  // are running, the stage replaces them.
  for (const pane of scripts.values()) pane.hidden = true;
  reset(key);
  const timer = setInterval(step, TICK);

  for (const chip of chips)
    chip.addEventListener("click", () => reset(chip.dataset.topic));

  // Nothing animates in a tab nobody is looking at.
  document.addEventListener("visibilitychange", () => {
    stopped = document.visibilityState !== "visible";
  });
  window.addEventListener("pagehide", () => clearInterval(timer));
})();
