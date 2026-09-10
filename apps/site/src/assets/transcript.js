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
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // A use-case page carries one transcript per case; each runs its own
  // clock in its own closure, so nothing on the page shares state.
  for (const root of document.querySelectorAll("[data-transcript]")) run(root);
})();

function run(root) {
  const scripts = new Map();
  for (const pane of root.querySelectorAll("[data-script]"))
    scripts.set(pane.dataset.script, pane);

  // One script needs no chips; its key is the only pane's.
  const chips = [...root.querySelectorAll("[data-topic]")];
  const stage = root.querySelector("[data-stage]");
  const thinking = root.querySelector("[data-thinking]");
  const toolbar = root.querySelector("[data-tools]");
  const keys =
    chips.length > 0 ? chips.map((c) => c.dataset.topic) : [...scripts.keys()];
  if (!stage || keys.length === 0) return;

  // Every line of every script, read out of the markup that already
  // renders them, so the copy lives in one place.
  const read = (key) =>
    [...scripts.get(key).querySelectorAll("[data-line]")].map((el) => ({
      role: el.dataset.line,
      text: el.querySelector("[data-text]").textContent.trim(),
      cite: el.querySelector("[data-cite]")?.textContent.trim() ?? null,
    }));

  let key = keys[0];
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
    finished = false;
    current = null;
    stage.replaceChildren();
    thinking.hidden = true;
    for (const chip of chips)
      chip.setAttribute("aria-pressed", chip.dataset.topic === key);
    if (toolbar) toolbar.dataset.for = key;
    for (const set of toolbar?.querySelectorAll("[data-tools-for]") ?? [])
      set.hidden = set.dataset.toolsFor !== key;
  }

  // The design's clock: 26ms ticks, a person types three characters a
  // tick and the agent two, and every exchange opens on a short hold so
  // the first bubble does not appear mid-load.
  const TICK = 26;
  const SPEED = { user: 3, agent: 2 };
  let finished = false;
  function step() {
    if (stopped) return;
    if (hold > 0) {
      hold -= 1;
      return;
    }
    if (at >= lines.length) {
      // Pause on the finished conversation first — it is the one frame a
      // reader actually reads — and only THEN move to the next topic, so
      // a visitor who leaves the tab open sees all three rather than one.
      // reset() zeroes the hold, so the pause has to be set after it;
      // setting it before was a hold that never happened.
      if (!finished) {
        finished = true;
        hold = 150;
        return;
      }
      // With one script there is nothing to move on to: replay it.
      reset(keys[(keys.indexOf(key) + 1) % keys.length]);
      hold = 10;
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
    ch = Math.min(line.text.length, ch + (SPEED[line.role] ?? 2));
    text.textContent = line.text.slice(0, ch);
    current.classList.toggle("transcript__typing", ch < line.text.length);
    if (ch >= line.text.length) {
      const cite = current.querySelector(".transcript__cite");
      if (cite) cite.hidden = false;
      current = null;
      at += 1;
      ch = 0;
      // The next line's hold: an agent takes a beat to answer, a person
      // a shorter one to read.
      const nextLine = lines[at];
      hold = nextLine?.role === "agent" ? 26 : 20;
    }
  }

  // The scripts are in the DOM for a reader without JavaScript; once we
  // are running, the stage replaces them.
  for (const pane of scripts.values()) pane.hidden = true;
  reset(key);
  hold = 6;
  const timer = setInterval(step, TICK);

  for (const chip of chips)
    chip.addEventListener("click", () => {
      reset(chip.dataset.topic);
      hold = 8;
    });

  // Nothing animates in a tab nobody is looking at.
  document.addEventListener("visibilitychange", () => {
    stopped = document.visibilityState !== "visible";
  });
  window.addEventListener("pagehide", () => clearInterval(timer));
}
