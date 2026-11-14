// Interactive sample state only. No API calls, persistence, earning engine or telemetry.
const [catalog, media] = await Promise.all([
  fetch("/catalog.json").then((r) => r.json()),
  fetch("/icons.json").then((r) => r.json()),
]);
const app = document.querySelector("#app");
const dialog = document.querySelector("#detail");
const scenario = document.querySelector("#scenario");
const status = document.querySelector("#status");
const params = new URLSearchParams(location.search);
if (params.has("capture")) document.body.classList.add("capture");
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const icon = (name) => media.icons[name] ?? "";
const roman = ["", "I", "II", "III"];
const date = "14 NOV 2026";
const byId = (id) => catalog.find((s) => s.id === id);
let view = location.hash.slice(1) || "passport";
let sample;
let returnFocus = null;
let focusHeadingAfterRender = false;
let noticeTimer;

function fixture(kind) {
  const earned = {
    player_verified: 1,
    looking_good: 1,
    on_the_map: 1,
    mutual: 1,
    played_together: 1,
  };
  const state = {
    kind,
    owner: !["visitor", "unverified"].includes(kind),
    name: kind === "visitor" ? "Ada" : "King Thing",
    verified: true,
    picture: true,
    city: "Example City",
    mapChoice: "shared",
    digest: null,
    follows: 2,
    alts: false,
    discord: false,
    earned,
    progress: { played_together: 2, cheerleader: 2, storyteller: 0 },
    notices: ["player_verified", "on_the_map"],
  };
  if (kind === "new" || kind === "unverified")
    Object.assign(state, {
      name: "Ada",
      verified: false,
      picture: false,
      city: "",
      mapChoice: null,
      follows: 0,
      earned: {},
      progress: { played_together: 0, cheerleader: 0, storyteller: 0 },
      notices: [],
    });
  if (kind === "complete")
    Object.assign(state, {
      digest: "weekly",
      alts: true,
      discord: true,
      follows: 5,
      earned: Object.fromEntries(
        catalog.map((s) => [s.id, s.thresholds.length]),
      ),
      progress: { played_together: 20, cheerleader: 50, storyteller: 20 },
    });
  if (kind === "map-choice") {
    state.city = "";
    state.mapChoice = null;
    state.digest = "off";
    delete state.earned.on_the_map;
  }
  if (kind === "past-proof") state.verified = false;
  return state;
}
function announce(message) {
  clearTimeout(noticeTimer);
  status.textContent = message;
  noticeTimer = setTimeout(() => {
    status.textContent = "";
  }, 4500);
}
function verification() {
  const m = media.mark;
  return (
    '<svg class="verification-mark" viewBox="' +
    m.viewBox +
    '" role="img" aria-label="Verified player"><path d="' +
    m.badge +
    '" fill="currentColor"/><path d="' +
    m.check +
    '" fill="none" stroke="var(--ground)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  );
}
function avatar(verified = sample.verified, name = sample.name) {
  const initials = name === "King Thing" ? "KT" : "AD";
  return (
    '<span class="avatar-sample' +
    (verified ? " verified" : "") +
    '" aria-hidden="true">' +
    initials +
    "</span>"
  );
}
function person(showCount = true) {
  return (
    '<div class="passport-person">' +
    avatar() +
    '<div><span class="person-name">' +
    esc(sample.name) +
    (sample.verified ? verification() : "") +
    '</span><span class="person-note">' +
    (sample.verified ? "Elixir account" : "Player not verified") +
    "</span></div>" +
    (showCount
      ? '<span class="earned-count">' +
        Object.keys(sample.earned).length +
        " Stamps earned</span>"
      : "") +
    "</div>"
  );
}
function stamp(s, interactive = true, large = false) {
  const level = sample.earned[s.id] ?? 0;
  const title =
    s.name + (level && s.thresholds.length > 1 ? " " + roman[level] : "");
  const label = title + (level ? ", earned November 14, 2026" : ", not earned");
  const tag = interactive ? "button" : "div";
  const attrs = interactive
    ? ' type="button" data-stamp="' + s.id + '" aria-label="' + esc(label) + '"'
    : ' aria-hidden="true"';
  return (
    "<" +
    tag +
    attrs +
    ' class="stamp-tile ' +
    (level ? "earned" : "") +
    " ink-" +
    s.ink +
    (large ? " large" : "") +
    '"><span class="stamp-mark ' +
    s.shape +
    '" style="--tilt:' +
    (catalog.indexOf(s) % 2 ? "1" : "-1.5") +
    'deg">' +
    icon(s.icon) +
    '<span class="stamp-title">' +
    esc(title) +
    '</span><span class="stamp-date">' +
    (level ? date : "ELIXIR") +
    "</span></span>" +
    (interactive
      ? '<span class="stamp-label">' +
        (level ? "Earned" : s.optional ? "Optional" : "Not earned") +
        "</span>"
      : "") +
    "</" +
    tag +
    ">"
  );
}
function steps() {
  return [
    {
      title: "Add your player",
      done: true,
      copy: sample.name + ", your main player.",
      action: "Your players",
      target: "verification",
    },
    {
      title: "Verify it’s you",
      done: sample.verified,
      copy: "Prove your player and earn Player verified.",
      action: "Verify your player",
      target: "verification",
    },
    {
      title: "Pick your picture",
      done: sample.picture,
      copy: "Make it yours. Earn Looking Good.",
      action: "Pick your picture",
      target: "picture",
    },
    {
      title: "Follow someone who plays",
      done: sample.follows > 0,
      copy: "One friend is enough. Five active follows earn Inner Circle.",
      action: "Find your people",
      target: "friends",
    },
    {
      title: "Choose your email",
      done: sample.digest !== null,
      copy: "Weekly, daily or off. Any choice counts.",
      action: "Choose your email",
      target: "email",
    },
    {
      title: "Your place on the clan map",
      done: sample.mapChoice !== null,
      copy: "Share a place, or choose Not now. Sharing earns On the Map. Your place stays on your clan’s map.",
      action: "Choose for the map",
      target: "map",
    },
  ];
}
function earn(id, level = 1) {
  if ((sample.earned[id] ?? 0) >= level) return;
  sample.earned[id] = level;
  sample.notices.unshift(id);
  announce(
    "New Stamp: " +
      byId(id).name +
      (byId(id).thresholds.length > 1 ? " " + roman[level] : ""),
  );
}
function finish() {
  if (steps().every((s) => s.done)) earn("all_set");
}
function miniPassport() {
  const ids = Object.keys(sample.earned).slice(0, 2);
  return (
    '<div class="mini-stamps">' +
    ids
      .map(
        (id) =>
          '<span class="mini" aria-hidden="true">' +
          icon(byId(id).icon) +
          "</span>",
      )
      .join("") +
    '<button class="text-link" data-nav="passport">' +
    Object.keys(sample.earned).length +
    " Stamps · Open passport " +
    icon("arrow-right") +
    "</button></div>"
  );
}
function passport() {
  let html =
    '<h1 tabindex="-1">' +
    (sample.owner ? "Your passport" : esc(sample.name) + "’s passport") +
    '</h1><p class="sub">Small marks for your Elixir story.</p>' +
    person();
  if (!Object.keys(sample.earned).length)
    html +=
      '<p class="detail-note">' +
      (sample.owner
        ? "Your first marks are ahead. Pick a Stamp to see how to earn it."
        : "No Stamps earned yet. Every account has a passport, with or without a verified player.") +
      "</p>";
  for (const group of ["Getting started", "Your circle", "Playing together"])
    html +=
      '<section class="stamp-section" aria-label="' +
      group +
      '"><h2>' +
      group +
      '</h2><div class="stamp-grid">' +
      catalog
        .filter((s) => s.group === group)
        .map((s) => stamp(s))
        .join("") +
      "</div></section>";
  html +=
    '<div class="passport-actions"><button class="btn btn--primary" data-action="share">Copy passport link</button>' +
    (sample.owner
      ? '<button class="btn" data-nav="profile">Your profile</button>'
      : "") +
    '</div><p class="passport-foot">Stamps are visible to Elixir members. They record milestones you’ve earned. The gold verification mark shows which player is verified now.</p>';
  return html;
}
function home() {
  const list = steps();
  const done = list.filter((s) => s.done).length;
  let html =
    '<h1 tabindex="-1">Home</h1><div class="preview-tabs"><span class="selected">Everyone</span><span>Friends</span><span>Clan</span><span>You</span></div>';
  if (done < 6) {
    const next = list.find((step) => !step.done);
    html +=
      '<section class="preview-panel"><h2>Your profile</h2><p class="detail-note">' +
      done +
      ' of 6 done. Make Elixir yours.</p><ol class="checklist"><li><span class="step-num">' +
      (list.indexOf(next) + 1) +
      '</span><div class="step-text"><h3>' +
      esc(next.title) +
      "</h3><p>" +
      esc(next.copy) +
      '</p><button class="btn btn--primary" data-action="' +
      next.target +
      '">' +
      next.action +
      '</button></div></li></ol><details class="completed-steps"><summary>See all steps</summary><ol class="checklist">' +
      list
        .map(
          (step, i) =>
            '<li><span class="step-num' +
            (step.done ? " done" : "") +
            '">' +
            (step.done ? icon("check") : i + 1) +
            '</span><div class="step-text"><strong>' +
            esc(step.title) +
            '</strong><p class="done-copy">' +
            esc(step.done ? "Done." : step.copy) +
            "</p></div></li>",
        )
        .join("") +
      '</ol></details><button class="text-link" data-nav="passport">Your passport ' +
      icon("arrow-right") +
      "</button></section>";
  } else
    html +=
      '<p class="detail-note">Your profile is ready. ' +
      '<button class="text-link" data-nav="passport">Open your passport</button></p>';
  html +=
    '<article class="preview-feed"><div class="passport-person">' +
    avatar(true, "Ada") +
    "<div><strong>Ada</strong> " +
    verification() +
    '<span class="person-note">Today</span></div></div><p>Reached a new Arena.</p><p class="detail-note">“Finally made it! That last battle was close.”</p><button class="btn" data-action="cheer">' +
    icon("heart-pulse") +
    ' Cheer</button></article><p class="passport-foot">Your friends’ play stays the feed. Stamps go in the passport and bell.</p>';
  return html;
}
function profile() {
  if (!sample.owner) return passport();
  return (
    '<h1 tabindex="-1">Profile</h1><p class="sub">Your identity, passport and account.</p><section class="preview-panel"><h2>Your player</h2>' +
    person(false) +
    '<button class="btn" data-action="picture">Pick your picture</button></section><section class="preview-panel"><h2>Your passport</h2><p>Every Elixir member can see your earned Stamps.</p>' +
    miniPassport() +
    '</section><section class="preview-panel"><h2>Account</h2><p class="detail-note">Email</p><p>jamie@example.com</p><p class="detail-note">Only you see your email and account settings.</p><button class="text-link" data-action="email">Manage your digest</button></section>'
  );
}
function player() {
  return (
    '<h1 tabindex="-1">' +
    (sample.verified ? esc(sample.name) : "Your account") +
    "</h1>" +
    person(false) +
    (!sample.verified
      ? '<p class="detail-note">Your player is not verified yet. Your account’s passport is still visible to other members.</p><button class="btn btn--primary" data-action="verification">Verify your player</button>'
      : '<p class="detail-note">#20JJJ2CCRU · POAP KINGS · 9,412 trophies</p>') +
    '<section aria-label="Elixir passport">' +
    miniPassport() +
    '</section><div class="preview-tabs"><span class="selected">Timeline</span><span>Highlights</span><span>Moments</span><span>Record</span></div><article class="preview-feed"><h2>Your play</h2><p>Reached a new Arena.</p></article>'
  );
}
function friends() {
  return (
    '<h1 tabindex="-1">Find your people</h1><p class="sub">Start with people you play with.</p><section class="preview-panel"><h2>From your battles</h2><p><strong>Ada</strong> ' +
    verification() +
    '</p><p class="detail-note">You played a friendly battle together. Already recorded, so following takes no new slot.</p><button class="btn btn--primary" data-action="follow">' +
    (sample.follows ? "Following" : "Follow Ada") +
    '</button></section><p class="passport-foot">One active friend completes your profile. You never need to follow strangers for a Stamp.</p>'
  );
}
function map() {
  if (sample.owner && !sample.verified)
    return '<h1 tabindex="-1">Your clan map</h1><p class="sub">Verify your player to use your clan’s map. You can choose Not now without sharing a place.</p><button class="btn btn--primary" data-action="verification">Verify your player</button><button class="btn" data-action="skip-map">Not now</button>';
  if (!sample.owner)
    return '<h1 tabindex="-1">Clan map</h1><p class="sub">A passport does not give access to someone else’s city. Map access follows the clan’s existing rules.</p><button class="btn" data-nav="passport">Back to passport</button>';
  return (
    '<h1 tabindex="-1">Your clan map</h1><p class="sub">Country, region or city. Seen only by your clan’s verified members while its map is on.</p><div class="map-place">' +
    icon("map-pin") +
    "<strong>" +
    (sample.city ? esc(sample.city) : "No place shared") +
    '</strong><span class="detail-note">Sample clan map</span></div><button class="btn btn--primary" data-action="map">' +
    (sample.city ? "Your map choice" : "Choose your place") +
    '</button><p class="passport-foot">You can finish Your profile with Not now. On the Map is earned only when you set a place.</p>'
  );
}
function render() {
  const body =
    sample.kind === "loading"
      ? '<h1 tabindex="-1">Your passport</h1><p class="sub" role="status">Loading your Stamps…</p><div class="stamp-grid" aria-busy="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>'
      : sample.kind === "error"
        ? '<h1 tabindex="-1">Your passport</h1><section class="preview-panel" role="alert"><h2>Your Stamps couldn’t load</h2><p>Try again. Your passport hasn’t changed.</p><button class="btn btn--primary" data-action="retry">Try again</button></section>'
        : (
            { passport, home, profile, player, friends, map }[view] ?? passport
          )();
  app.innerHTML =
    '<header class="preview-top"><a class="preview-brand" href="#home" data-nav="home"><img src="/assets/elixir-logo-288.webp" alt=""/><span>Elixir</span></a><button class="icon-button" data-action="about" aria-label="About this preview">' +
    icon("circle-help") +
    '</button><button class="icon-button" data-action="account" aria-label="Account menu">' +
    avatar(
      sample.owner ? sample.verified : true,
      sample.owner ? sample.name : "King Thing",
    ) +
    '</button></header><main class="preview-main">' +
    body +
    '<p class="passport-foot">' +
    esc(media.disclaimer) +
    '</p></main><nav class="preview-bottom" aria-label="Main navigation">' +
    [
      ["house", "Home", "home"],
      ["users", "Find", "friends"],
      ["castle", "Clan", "map"],
      ["user-round", "You", "player"],
      ["bell", "Bell", "bell"],
    ]
      .map(
        ([glyph, label, target]) =>
          "<button" +
          (view === target ? ' class="active"' : "") +
          " data-" +
          (target === "bell" ? "action" : "nav") +
          '="' +
          target +
          '">' +
          icon(glyph) +
          "<span>" +
          label +
          (target === "bell" && sample.notices.length
            ? " · " + sample.notices.length
            : "") +
          "</span></button>",
      )
      .join("") +
    "</nav>";
  if (focusHeadingAfterRender) {
    focusHeadingAfterRender = false;
    document.querySelector("main h1")?.focus();
  }
}
function closeModal(restore = true) {
  const wasOpen = dialog.open;
  dialog.close();
  if (wasOpen && !restore) focusHeadingAfterRender = true;
  if (restore && returnFocus?.isConnected) returnFocus.focus();
}
function openModal(title, body) {
  if (!dialog.open) returnFocus = document.activeElement;
  dialog.innerHTML =
    '<header class="detail-head"><h2 id="detail-title">' +
    esc(title) +
    '</h2><button class="icon-button" data-close aria-label="Close">' +
    icon("x") +
    '</button></header><div class="detail-body">' +
    body +
    "</div>";
  if (!dialog.open) dialog.showModal();
}
function go(target) {
  closeModal(false);
  view = target;
  if (location.hash.slice(1) !== target) location.hash = target;
  render();
  document.querySelector("main h1")?.focus();
}
function openStamp(id) {
  const s = byId(id),
    level = sample.earned[id] ?? 0;
  const next = s.thresholds[level];
  let body =
    stamp(s, false, true) +
    "<p><strong>" +
    (level ? "Earned 14 November 2026" : "Not earned yet") +
    "</strong></p><p>" +
    esc(s.rule) +
    "</p>";
  if (id === "on_the_map")
    body +=
      '<p class="detail-note">This Stamp is visible to Elixir members. The place is only shown on the account owner’s clan map.</p>';
  if (id === "player_verified")
    body +=
      '<p class="detail-note">This dated Stamp records a player verification milestone. The gold mark beside a player shows current proof of ownership.</p>';
  if (s.thresholds.length > 1)
    body +=
      '<ul class="level-list">' +
      s.thresholds
        .map(
          (n, i) =>
            "<li><strong>" +
            roman[i + 1] +
            "</strong> " +
            n +
            " " +
            s.unit +
            "<span>" +
            (level > i ? "Earned" : "Ahead") +
            "</span></li>",
        )
        .join("") +
      '<p class="detail-note">Totals, not streaks. Earned levels stay earned.</p>';
  if (sample.owner && next && s.thresholds.length > 1)
    body +=
      '<p class="detail-note">Your progress: ' +
      sample.progress[id] +
      " of " +
      next +
      " " +
      s.unit +
      ".</p>";
  if (sample.owner)
    body +=
      '<button class="btn btn--primary" data-action="' +
      s.destination +
      '">' +
      s.action +
      "</button>";
  else body += '<button class="btn" data-close>Close</button>';
  openModal(s.name, body);
}
function action(name) {
  if (name === "own-passport" || name === "own-profile") {
    sample = fixture("owner");
    scenario.value = "owner";
    go(name === "own-profile" ? "profile" : "passport");
    return;
  }
  if (name === "map-view") {
    go("map");
    return;
  }
  if (name === "home" || name === "player" || name === "friends") {
    go(name);
    return;
  }
  if (name === "retry") {
    sample = fixture("owner");
    scenario.value = "owner";
    render();
    return;
  }
  if (name === "account") {
    openModal(
      "Your account",
      '<button class="btn btn--primary" data-action="own-passport">Your passport</button><button class="btn" data-action="own-profile">Profile</button><p class="detail-note">Every account has a passport, even before its player is verified.</p>',
    );
    return;
  }
  if (name === "about") {
    openModal(
      "Design preview",
      '<p>This is a local prototype for the next build session. Every account, Stamp and action here is sample data. No email, game action, account setting or earned Stamp is sent or saved.</p><button class="btn" data-close>Back to the preview</button>',
    );
    return;
  }
  if (name === "bell") {
    openModal(
      "Bell",
      "<h3>New</h3>" +
        sample.notices
          .map(
            (id) =>
              '<button class="notification" data-stamp="' +
              id +
              '"><span class="notice-icon">' +
              icon(byId(id).icon) +
              "</span><span><strong>New Stamp: " +
              byId(id).name +
              "</strong><small>In your passport · Today</small></span></button>",
          )
          .join("") +
        '<button class="notification" data-nav="home"><span class="notice-icon">' +
        icon("heart-pulse") +
        '</span><span>3 cheers on your highlight<small>Today · Open your highlight</small></span></button><h3 class="stamp-section">Needs you</h3><button class="notification" data-nav="map"><span class="notice-icon">' +
        icon("castle") +
        "</span><span>A welcome is waiting in your clan<small>Review in Clan</small></span></button>",
    );
    return;
  }
  if (name === "email") {
    openModal(
      "Choose your email",
      "<p>Your digest brings your friends’ play and your clan’s news together. Any choice finishes this step.</p>" +
        ["weekly", "daily", "off"]
          .map(
            (choice) =>
              '<button class="btn' +
              (choice === "weekly" ? " btn--primary" : "") +
              '" data-email="' +
              choice +
              '">' +
              choice[0].toUpperCase() +
              choice.slice(1) +
              "</button>",
          )
          .join("") +
        '<p class="detail-note">Off counts too. Stamps never turn email on.</p>',
    );
    return;
  }
  if (name === "map") {
    if (!sample.owner || !sample.verified) {
      go("map");
      return;
    }
    openModal(
      "Your place on the clan map",
      '<p>Only your clan’s verified members can see your place, while its map is on. Your passport shows the milestone, never the city.</p><label for="city">Place</label><select id="city"><option value="Example City">Example City</option><option value="Example Country">Country only: Example Country</option></select><button class="btn btn--primary" data-action="save-map">Save place</button><button class="btn" data-action="skip-map">' +
        (sample.city ? "Remove shared place" : "Not now") +
        '</button><p class="detail-note">Not now completes the profile choice. Sharing a place earns On the Map.</p>',
    );
    return;
  }
  if (name === "save-map" || name === "skip-map") {
    sample.city =
      name === "save-map"
        ? (document.querySelector("#city")?.value ?? "Example City")
        : "";
    sample.mapChoice = sample.city ? "shared" : "not_now";
    if (sample.city) earn("on_the_map");
    finish();
    closeModal(false);
    render();
    announce(
      sample.city
        ? "Place saved in this preview. On the Map is in your passport."
        : "No place shared. Your profile choice is done.",
    );
    return;
  }
  if (name === "picture") {
    openModal(
      "Pick your picture",
      '<p>Make your player yours. Choosing art never proves ownership.</p><button class="btn btn--primary" data-action="save-picture">Use this sample picture</button><p class="detail-note">The next build uses Elixir’s existing card picker and exact crops.</p>',
    );
    return;
  }
  if (name === "save-picture") {
    sample.picture = true;
    earn("looking_good");
    finish();
    closeModal(false);
    render();
    return;
  }
  if (name === "verification") {
    openModal(
      "Verify your player",
      '<p>Elixir asks you to play a battle with a verification deck. The next build keeps that existing proof flow.</p><p class="detail-note">The button below switches sample state only. It does not verify a real player.</p><button class="btn btn--primary" data-action="sample-verified">Preview successful verification</button>',
    );
    return;
  }
  if (name === "sample-verified") {
    sample.verified = true;
    earn("player_verified");
    finish();
    closeModal(false);
    render();
    return;
  }
  if (name === "alts" || name === "discord") {
    openModal(
      name === "alts" ? "Your other players" : "Connect Discord",
      "<p>" +
        (name === "alts"
          ? "Adding another of your players earns Full Roster. It stays optional."
          : "Connecting Discord earns Linked. Your Discord name is not shown in your passport.") +
        '</p><p class="detail-note">This sample does not connect or claim anything.</p><button class="btn btn--primary" data-sample="' +
        name +
        '">Preview completed step</button>',
    );
    return;
  }
  if (name === "follow") {
    if (!sample.follows) {
      sample.follows = 1;
      finish();
      announce(
        "Following Ada in this preview. One active friend completes the profile step.",
      );
    } else
      announce(
        "Already following Ada. Mutual is earned only after a real follow back.",
      );
    render();
    return;
  }
  if (name === "cheer") {
    announce(
      "Cheer preview. Cheerleader counts distinct days, so repeated taps never add days.",
    );
    return;
  }
  if (name === "share") {
    const link =
      location.origin +
      "/?state=" +
      (sample.verified ? "visitor" : "unverified") +
      "#passport";
    openModal(
      "Passport link",
      '<p>Elixir members can open the passport of any account. This sample link stays on the local preview server.</p><label for="passport-link">Link</label><input id="passport-link" readonly value="' +
        esc(link) +
        '"/><button class="btn btn--primary" data-action="copy-link">Copy link</button>',
    );
    return;
  }
  if (name === "copy-link") {
    const input = document.querySelector("#passport-link");
    navigator.clipboard
      ?.writeText(input.value)
      .then(() => announce("Preview passport link copied."))
      .catch(() => {
        input.select();
        announce("Select and copy the preview link.");
      });
    return;
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.hasAttribute("data-close")) closeModal();
  else if (target.dataset.stamp) openStamp(target.dataset.stamp);
  else if (target.dataset.nav) {
    event.preventDefault();
    go(target.dataset.nav);
  } else if (target.dataset.email) {
    sample.digest = target.dataset.email;
    finish();
    closeModal(false);
    render();
    announce(
      "Email choice saved in this preview. Off, daily and weekly all count.",
    );
  } else if (target.dataset.sample) {
    const id = target.dataset.sample === "alts" ? "full_roster" : "linked";
    sample[target.dataset.sample] = true;
    earn(id);
    closeModal(false);
    render();
  } else if (target.dataset.action) action(target.dataset.action);
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeModal();
  }
});
scenario.addEventListener("change", () => {
  sample = fixture(scenario.value);
  view = "passport";
  closeModal(false);
  render();
});
document.querySelector("#reset").addEventListener("click", () => {
  sample = fixture(scenario.value);
  closeModal(false);
  render();
  announce("Sample reset.");
});
window.addEventListener("hashchange", () => {
  const target = location.hash.slice(1) || "passport";
  if (target === view) return;
  view = target;
  render();
  document.querySelector("main h1")?.focus();
});
scenario.value = params.get("state") || "owner";
sample = fixture(scenario.value);
render();
