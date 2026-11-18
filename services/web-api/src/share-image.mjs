/** A battle's share picture, /battle/<short id>.png. Jamie, 2026-10-01:
 *  "I'd rather the share version look more like the web version with
 *  the cards in the familiar 2x4 and player names in left and right. It
 *  should show tier health, elixir. Many of the details." And no embed
 *  for a blog: "just the image and a link is fine."
 *
 *  1200 by 630, the size chats and posts unfurl. It is drawn as SVG from
 *  the page's own projection (battle-page.mjs), so the picture never
 *  says what the page does not, and rasterised by resvg's WebAssembly
 *  build. The wasm and the fonts come from `assets`, each card's art
 *  from `cardArt` (the site bucket's mirror), so a test draws it with no
 *  network. A card with no art is its name in the frame, as on the page.
 *  An image has no reader's clock, so its time says UTC. */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { DISCLAIMER } from "@elixir-mcp/contracts";
import { whenAt } from "@elixir-mcp/ui/time";
import { deckDisplayCards } from "@elixir-mcp/ui/deck-display";
import { fontMetrics } from "./font-metrics.mjs";
import { scoreOf } from "./battle-page.mjs";
import {
  SITTINGS,
  deckCaption,
  modesSaid,
  sessionChips,
  sessionHeadline,
  signedCount,
  trophyNet,
} from "@elixir-mcp/ui/session-story";

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;

// The design tokens (packages/design/src/tokens.css) and the battle
// page's own colours: a win is blue and a loss rose on this ground.
const C = {
  ground: "#0c0920",
  wash: "#1c1450",
  panel: "#1a1440",
  raised: "#221a52",
  line: "#3a3175",
  lineSoft: "#2d2560",
  lineStrong: "#4c4193",
  ink: "#faf8ff",
  body: "#ddd7f5",
  dim: "#bdb4e2",
  faint: "#a29ad0",
  link: "#b49dfb",
  gold: "#f5c84c",
  goldLight: "#ffe99a",
  win: "#7fb6f8",
  loss: "#fb7185",
  evo: "#d946ef",
  onForm: "#160f2e",
};
const MODE_DOT = {
  ladder: "#a78bfa",
  ranked: "#7fb6f8",
  war: "#f472b6",
  event: "#2dd4bf",
  challenge: "#2dd4bf",
  tournament: "#2dd4bf",
};
const MODE_LABEL = {
  ladder: "Trophy Road",
  ranked: "Ranked",
  war: "War",
  casual: "Casual",
  challenge: "Challenge",
  event: "Event",
  tournament: "Tournament",
};
/** What the crowns prove about the length (the page's DURATION). */
const ENDED = {
  king_tower_fell: ["A King Tower fell", "5:00 or less"],
  regulation_ran: ["Went to time", "3:00 to 5:00"],
  overtime_expired: ["Overtime ran out", "5:00"],
};
const FORM = { evolution: ["Evo", C.evo], hero: ["Hero", C.gold] };
const CARD_RATIO = 420 / 285;

const PAD = 44;
const SIDE_W = 470;
const RIGHT_X = SHARE_WIDTH - PAD;
const MID_X = SHARE_WIDTH / 2;

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const fixed = (n, d) => (typeof n === "number" ? n.toFixed(d) : "—");
const tone = (outcome) =>
  outcome === "win" ? C.win : outcome === "loss" ? C.loss : C.faint;
const namesOf = (side) =>
  side.players.map((p) => p.name ?? p.player_tag).join(" and ") || "Unknown";

/** The resvg module initialises once per process, however many
 *  renderers ask (a second initWasm throws). */
let wasmReady = null;

export function makeShareImage({ assets, cardArt = async () => null }) {
  let loaded = null;
  const load = () =>
    (loaded ??= (async () => {
      const a = await assets();
      wasmReady ??= initWasm(a.wasm);
      await wasmReady;
      return {
        fonts: [a.interRegular, a.interBold, a.clash],
        regular: fontMetrics(a.interRegular),
        bold: fontMetrics(a.interBold),
        clash: fontMetrics(a.clash),
      };
    })());

  /** A battle's read draws the battle; a public session's read
   *  (session-page.mjs, `session: true`) draws the session's card. */
  return async function render(read) {
    const f = await load();
    const art = await artFor(read, cardArt);
    const svg = read.shared
      ? drawItem(read, { ...f, art })
      : read.session
        ? drawSession(read, { ...f, art })
        : drawBattle(read, { ...f, art });
    const resvg = new Resvg(svg, {
      fitTo: { mode: "original" },
      font: { fontBuffers: f.fonts, defaultFontFamily: "Inter" },
    });
    const image = resvg.render();
    const png = image.asPng();
    image.free();
    resvg.free();
    return png;
  };
}

/** Every card the picture shows, its art read once. */
async function artFor(read, cardArt) {
  const cards = new Map();
  const sessionDeck = read.session
    ? (read.item?.deck ?? topDeck(read.games))
    : null;
  for (const c of [
    ...(read.item?.deck?.cards ?? []),
    ...(read.item?.post?.deck?.cards ?? []),
    ...(read.item?.post?.cards ?? []),
    ...(read.item?.post?.versus?.mine?.cards ?? []),
    ...(read.item?.post?.versus?.theirs?.cards ?? []),
  ])
    cards.set(`${c.id}:${c.form ?? "base"}`, c);
  for (const side of read.item?.sides ?? [])
    for (const p of side.players)
      for (const c of shownDeck(read.item, p)?.cards ?? [])
        cards.set(`${c.id}:${c.form ?? "base"}`, c);
  for (const c of sessionDeck?.cards ?? [])
    cards.set(`${c.id}:${c.form ?? "base"}`, c);
  for (const side of read.sides ?? [])
    for (const p of side.players)
      for (const c of shownDeck(read, p)?.cards ?? [])
        cards.set(`${c.id}:${c.form ?? "base"}`, c);
  const out = new Map();
  for (const [key, card] of cards) {
    const bytes = await cardArt(card).catch(() => null);
    if (bytes) out.set(key, Buffer.from(bytes).toString("base64"));
  }
  return out;
}

/** The deck the picture shows for a player: a duel's last game. */
function shownDeck(read, player) {
  if (player.deck) return player.deck;
  const rounds = player.rounds ?? [];
  return rounds.length ? rounds[rounds.length - 1] : null;
}

/** A line of text no wider than `max`, shortened with an ellipsis. */
const fit = (text, metrics, size, max) => {
  const s = String(text);
  if (metrics.width(s, size) <= max) return s;
  let cut = s;
  while (cut.length > 1 && metrics.width(`${cut}…`, size) > max)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};
/** One line of text, escaped as it is written unless `raw`. */
const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.family ?? "Inter"}" font-size="${o.size ?? 16}"${o.weight ? ` font-weight="${o.weight}"` : ""} fill="${o.fill ?? C.body}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${o.raw ? s : esc(s)}</text>`;

/** The ground every picture is drawn on. */
const GROUND = `<defs>
    <radialGradient id="wash" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${C.wash}"/>
      <stop offset="100%" stop-color="${C.ground}"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.goldLight}"/>
      <stop offset="100%" stop-color="${C.gold}"/>
    </linearGradient>
  </defs>
  <rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#wash)"/>`;

/** The SVG for one battle (exported for the tests, which read it). */
export function drawBattle(read, f) {
  const { battle, sides, games } = read;
  const [l, r] = sides;
  const last = games?.length ? games[games.length - 1] : null;
  const out = [];
  const push = (s) => out.push(s);

  // ---- ground
  push(`<defs>
    <radialGradient id="wash" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${C.wash}"/>
      <stop offset="100%" stop-color="${C.ground}"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.goldLight}"/>
      <stop offset="100%" stop-color="${C.gold}"/>
    </linearGradient>
  </defs>`);
  push(
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#wash)"/>`,
  );

  // ---- the bar: wordmark, mode, arena, time
  push(
    text(PAD, 62, "Elixir", { family: "Clash", size: 38, fill: "url(#gold)" }),
  );
  let x = PAD + f.clash.width("Elixir", 38) + 22;
  const mode = MODE_LABEL[battle.mode_group] ?? battle.game_mode?.name ?? null;
  if (mode) {
    const kind =
      battle.kind === "duel"
        ? " · duel"
        : battle.kind === "2v2"
          ? " · 2v2"
          : "";
    const label = `${mode}${kind}`;
    const w = 34 + f.regular.width(label, 17) + 16;
    push(
      `<rect x="${x}" y="33" width="${w}" height="36" rx="18" fill="${C.panel}" stroke="${C.line}"/>`,
    );
    push(
      `<rect x="${x + 15}" y="46" width="10" height="10" rx="3" fill="${MODE_DOT[battle.mode_group] ?? C.faint}"/>`,
    );
    push(text(x + 34, 57, label, { size: 17 }));
    x += w + 16;
  }
  // A picture outlives the week it was made in, and nobody's clock is on
  // it: the whole date, with its year, in UTC. `now: 0` keeps the year.
  const when = whenAt(battle.battle_time, null, { now: 0 });
  const whenW = f.regular.width(when, 17);
  if (battle.arena?.name)
    push(
      text(
        x,
        57,
        fit(battle.arena.name, f.regular, 17, RIGHT_X - whenW - 24 - x),
        { size: 17, fill: C.dim },
      ),
    );
  push(text(RIGHT_X, 57, when, { size: 17, fill: C.faint, anchor: "end" }));
  push(
    `<line x1="0" y1="88" x2="${SHARE_WIDTH}" y2="88" stroke="${C.lineSoft}"/>`,
  );

  // ---- the two sides
  sides.forEach((side, i) => {
    const towers = last ? (last.sides[i]?.tower_hp ?? null) : side.tower_hp;
    const leak = last
      ? (last.sides[i]?.elixir_leaked ?? null)
      : side.players.length === 1
        ? side.players[0].elixir_leaked
        : null;
    drawSide(push, f, read, side, i === 0, { towers, leak, text, fit });
  });

  // ---- between them: the score and how it ended
  // The read's one score: games won where the record holds them and
  // they agree with the result, else the crowns (battle-page.mjs).
  const score = read.score ?? scoreOf(l, r, games);
  const crowns = [score.left, score.right];
  push(
    text(MID_X - 44, 252, crowns[0] ?? "?", {
      family: "Clash",
      size: 78,
      fill: tone(l.outcome),
      anchor: "middle",
    }),
  );
  push(
    text(MID_X, 242, "–", {
      family: "Clash",
      size: 46,
      fill: C.lineStrong,
      anchor: "middle",
    }),
  );
  push(
    text(MID_X + 44, 252, crowns[1] ?? "?", {
      family: "Clash",
      size: 78,
      fill: tone(r.outcome),
      anchor: "middle",
    }),
  );
  // The result in words, as the page's chip says it: colour alone
  // would not tell a reader which side is which.
  const winner = l.outcome === "win" ? l : l.outcome === "loss" ? r : null;
  // A team is its side: two names will not fit, and one would say the
  // other did not play.
  const said = !winner
    ? "Draw"
    : winner.players.length > 1
      ? `${winner === l ? "Left" : "Right"} team won`
      : `${fit(namesOf(winner), f.bold, 15, 150 - f.bold.width(" won", 15))} won`;
  const chipW = f.bold.width(said, 15) + 26;
  push(
    `<rect x="${MID_X - chipW / 2}" y="276" width="${chipW}" height="30" rx="15" fill="${winner ? (winner === l ? "rgba(127,182,248,0.14)" : "rgba(251,113,133,0.12)") : C.raised}" stroke="${winner ? (winner === l ? "rgba(127,182,248,0.5)" : "rgba(251,113,133,0.45)") : C.lineStrong}"/>`,
  );
  push(
    text(MID_X, 296, said, {
      size: 15,
      weight: 700,
      fill: winner ? (winner === l ? "#cfe3fd" : "#fecdd3") : C.body,
      anchor: "middle",
    }),
  );
  let y = 334;
  if (games) {
    push(
      text(
        MID_X,
        y,
        score.unit === "games"
          ? `games · crowns ${l.crowns ?? "?"}–${r.crowns ?? "?"}`
          : `crowns over ${games.length} games`,
        {
          size: 15,
          fill: C.dim,
          anchor: "middle",
        },
      ),
    );
    y += 26;
  }
  const ended = ENDED[battle.duration?.basis];
  if (ended && !games) {
    push(text(MID_X, y, ended[0], { size: 15, fill: C.dim, anchor: "middle" }));
    push(
      text(MID_X, y + 22, ended[1], {
        size: 16,
        weight: 700,
        fill: C.body,
        anchor: "middle",
      }),
    );
    y += 58;
  }
  const levels = sides.map((s) =>
    s.players.length === 1
      ? shownDeck(read, s.players[0])?.average_level
      : null,
  );
  if (typeof levels[0] === "number" && typeof levels[1] === "number") {
    push(
      text(MID_X, y, "CARD LEVEL", {
        size: 12,
        fill: C.faint,
        anchor: "middle",
        spacing: 1.2,
      }),
    );
    push(
      text(MID_X, y + 22, `${fixed(levels[0], 1)} – ${fixed(levels[1], 1)}`, {
        size: 16,
        weight: 700,
        fill: C.body,
        anchor: "middle",
      }),
    );
    y += 54;
  }
  if (last)
    push(
      text(MID_X, y, `Decks and towers`, {
        size: 14,
        fill: C.faint,
        anchor: "middle",
      }) +
        text(MID_X, y + 19, `from game ${last.round}`, {
          size: 14,
          fill: C.faint,
          anchor: "middle",
        }),
    );

  // ---- the foot: the link and the disclaimer
  push(
    `<line x1="0" y1="578" x2="${SHARE_WIDTH}" y2="578" stroke="${C.lineSoft}"/>`,
  );
  const cut = DISCLAIMER.indexOf(". ") + 1;
  // A shared post about a battle (#762, 0292) says whose post it is and
  // their words on one line, fitted beside the disclaimer, over the
  // post's own link;
  // a battle's picture carries the battle's link alone. Each string is
  // escaped by text() as it is written, never before.
  const h = read.post ?? null;
  if (h) {
    const room =
      RIGHT_X -
      Math.max(
        f.regular.width(DISCLAIMER.slice(0, cut), 12),
        f.regular.width(DISCLAIMER.slice(cut).trim(), 12),
      ) -
      32 -
      PAD;
    const who = `${h.name ?? h.player_tag}`;
    const words = String(h.words ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const whoW = f.bold.width(`${who}${words ? ":" : ""}`, 16);
    push(
      text(PAD, 600, fit(`${who}${words ? ":" : ""}`, f.bold, 16, room), {
        size: 16,
        weight: 700,
        fill: C.body,
      }),
    );
    if (words && whoW + 8 < room)
      push(
        text(
          PAD + whoW + 8,
          600,
          fit(`“${words}”`, f.regular, 16, room - whoW - 8),
          { size: 16, fill: C.dim },
        ),
      );
    push(
      text(PAD, 621, h.url.replace(/^https:\/\//, ""), {
        size: 14,
        weight: 700,
        fill: C.link,
      }),
    );
  } else if (battle.url)
    push(
      text(PAD, 612, battle.url.replace(/^https:\/\//, ""), {
        size: 18,
        weight: 700,
        fill: C.link,
      }),
    );
  push(
    text(RIGHT_X, 600, DISCLAIMER.slice(0, cut), {
      size: 12,
      fill: C.faint,
      anchor: "end",
    }),
  );
  push(
    text(RIGHT_X, 617, DISCLAIMER.slice(cut).trim(), {
      size: 12,
      fill: C.faint,
      anchor: "end",
    }),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">${out.join("\n")}</svg>`;
}

/** One side: who, the deck as the game lays it out, the numbers beside
 *  it, the three towers and the tower troop. The right side mirrors the
 *  left, so each deck sits on its own edge and the numbers face the
 *  score. */
function drawSide(push, f, read, side, isLeft, { towers, leak, text, fit }) {
  const x0 = isLeft ? PAD : RIGHT_X - SIDE_W;
  const edge = isLeft ? PAD : RIGHT_X;
  const anchor = isLeft ? undefined : "end";
  const team = side.players.length > 1;

  // Who: a dot in the result's colour, the name, the clan and trophies.
  const dotX = isLeft ? PAD + 7 : RIGHT_X - 7;
  push(
    `<circle cx="${dotX}" cy="${team ? 120 : 127}" r="7" fill="${tone(side.outcome)}"/>`,
  );
  const nameX = isLeft ? PAD + 24 : RIGHT_X - 24;
  if (team) {
    side.players.forEach((p, k) => {
      const y = k === 0 ? 128 : 290;
      if (k > 0)
        push(
          `<circle cx="${dotX}" cy="${y - 8}" r="7" fill="${tone(side.outcome)}"/>`,
        );
      push(
        text(nameX, y, fit(p.name ?? p.player_tag, f.bold, 22, SIDE_W - 30), {
          size: 22,
          weight: 700,
          fill: C.ink,
          anchor,
        }),
      );
      const deck = shownDeck(read, p);
      const sub = [
        p.clan_name ?? p.clan_tag,
        deck?.average_elixir != null
          ? `${fixed(deck.average_elixir, 2)} average elixir`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (sub)
        push(
          text(nameX, y + 22, fit(sub, f.regular, 15, SIDE_W - 30), {
            size: 15,
            fill: C.dim,
            anchor,
          }),
        );
      drawDeck(push, f, read, deck, {
        x: isLeft ? x0 : RIGHT_X - deckWidth(8, 52, 5),
        y: y + 36,
        w: 52,
        cols: 8,
        gap: 5,
      });
    });
  } else {
    const p = side.players[0];
    push(
      text(
        nameX,
        138,
        fit(p?.name ?? p?.player_tag ?? "Unknown", f.bold, 32, SIDE_W - 30),
        {
          size: 32,
          weight: 700,
          fill: C.ink,
          anchor,
        },
      ),
    );
    const ladder =
      read.battle.mode_group === "ladder" &&
      typeof p?.starting_trophies === "number";
    const clan = p?.clan_name ?? p?.clan_tag ?? null;
    const parts = [];
    if (clan) parts.push(esc(fit(clan, f.regular, 17, 260)));
    if (ladder) {
      const change =
        typeof p.trophy_change === "number"
          ? ` <tspan fill="${p.trophy_change >= 0 ? C.win : C.loss}">${p.trophy_change >= 0 ? "+" : "−"}${Math.abs(p.trophy_change)}</tspan>`
          : "";
      parts.push(`${num(p.starting_trophies)} trophies${change}`);
    }
    if (parts.length)
      push(
        text(nameX, 166, parts.join(" · "), {
          size: 17,
          fill: C.dim,
          anchor,
          raw: true,
        }),
      );
    const deck = p ? shownDeck(read, p) : null;
    const cardW = 78;
    const gridW = deckWidth(4, cardW, 10);
    drawDeck(push, f, read, deck, {
      x: isLeft ? x0 : RIGHT_X - gridW,
      y: 190,
      w: cardW,
      cols: 4,
      gap: 10,
    });
    // The numbers beside the deck, facing the score.
    const sx = isLeft ? x0 + gridW + 20 : RIGHT_X - gridW - 20;
    const stats = [
      ["AVG ELIXIR", fixed(deck?.average_elixir, 2)],
      ["CHEAPEST FOUR", deck?.cycle4 ?? "—"],
      ["LEAKED", fixed(leak, 2)],
    ];
    stats.forEach(([label, value], k) => {
      const y = 212 + k * 78;
      push(text(sx, y, label, { size: 12, fill: C.faint, anchor, spacing: 1 }));
      push(
        text(sx, y + 32, value, { size: 28, weight: 700, fill: C.ink, anchor }),
      );
    });
  }

  // The three towers as the arena has them (Jamie, 2026-11-13): a
  // Princess Tower, the King Tower in the middle, the other Princess
  // Tower. Hitpoints left, as the game reports them; the Princess Towers
  // keep the game's order, first on the left (never a lane). A missing
  // value is drawn as not recorded, so the King always sits in the middle.
  const tiles = towers
    ? [
        ["Princess Tower", towers.princess?.[0] ?? null],
        ["King Tower", towers.king ?? null],
        ["Princess Tower", towers.princess?.[1] ?? null],
      ]
    : [];
  const ty = 470;
  const tw = (SIDE_W - 20) / 3;
  tiles.forEach(([label, hp], k) => {
    const tx = isLeft ? x0 + k * (tw + 10) : RIGHT_X - (3 - k) * (tw + 10) + 10;
    const down = hp === 0;
    // The King, in the middle, a touch heavier: a firmer edge, a brighter label.
    const king = k === 1;
    push(
      `<rect x="${tx}" y="${ty}" width="${tw}" height="64" rx="10" fill="${down ? C.ground : C.panel}" stroke="${down ? C.lineSoft : king ? C.lineStrong : C.line}"/>`,
    );
    push(
      text(tx + 14, ty + 24, label, { size: 13, fill: king ? C.dim : C.faint }),
    );
    push(
      text(tx + 14, ty + 51, down ? "Down" : hp === null ? "—" : num(hp), {
        size: 22,
        weight: 700,
        fill: down ? C.loss : C.ink,
      }),
    );
  });
  if (!towers)
    push(
      text(edge, ty + 38, "No tower hitpoints recorded", {
        size: 15,
        fill: C.faint,
        anchor,
      }),
    );
  const troop = team
    ? null
    : shownDeck(read, side.players[0] ?? {})?.tower_troop;
  if (troop?.name)
    push(
      text(
        edge,
        560,
        `Tower troop: ${troop.name}${troop.level ? `, level ${troop.level}` : ""}`,
        { size: 15, fill: C.dim, anchor },
      ),
    );
}

const deckWidth = (cols, w, gap) => cols * w + (cols - 1) * gap;

/** A deck as the game lays it out, each card with its form and level. */
function drawDeck(push, f, read, deck, { x, y, w, cols, gap }) {
  const h = Math.round(w * CARD_RATIO);
  if (!deck?.cards?.length) {
    const rows = cols === 4 ? 2 : 1;
    push(
      `<rect x="${x}" y="${y}" width="${deckWidth(cols, w, gap)}" height="${rows * h + (rows - 1) * 22}" rx="12" fill="none" stroke="${C.lineStrong}" stroke-dasharray="6 5"/>`,
    );
    push(
      `<text x="${x + deckWidth(cols, w, gap) / 2}" y="${y + (rows * h) / 2 + 6}" font-family="Inter" font-size="16" fill="${C.faint}" text-anchor="middle">No deck recorded</text>`,
    );
    return;
  }
  deckDisplayCards(deck.cards)
    .slice(0, 8)
    .forEach((card, k) => {
      const cx = x + (k % cols) * (w + gap);
      const cy = y + Math.floor(k / cols) * (h + 22);
      const art = f.art.get(`${card.id}:${card.form ?? "base"}`);
      if (art) {
        push(
          `<image x="${cx}" y="${cy}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${art}"/>`,
        );
      } else {
        push(
          `<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${w - 1}" height="${h - 1}" rx="8" fill="${C.raised}" stroke="${C.lineStrong}" stroke-dasharray="4 3"/>`,
        );
        const size = w > 60 ? 12 : 9.5;
        const lines = wrap(card.name, f.regular, size, w - 8).slice(0, 3);
        lines.forEach((line, n) =>
          push(
            `<text x="${cx + w / 2}" y="${cy + h / 2 - ((lines.length - 1) * size * 1.2) / 2 + n * size * 1.2 + size / 3}" font-family="Inter" font-size="${size}" fill="${C.dim}" text-anchor="middle">${esc(line)}</text>`,
          ),
        );
      }
      const form = FORM[card.form];
      if (form) {
        const fs = w > 60 ? 11 : 8.5;
        const fw = f.bold.width(form[0], fs) + (w > 60 ? 12 : 8);
        push(
          `<rect x="${cx + (w - fw) / 2}" y="${cy + 4}" width="${fw}" height="${fs + 6}" rx="${(fs + 6) / 2}" fill="${form[1]}"/>`,
        );
        push(
          `<text x="${cx + w / 2}" y="${cy + 4 + fs + 1.5}" font-family="Inter" font-size="${fs}" font-weight="700" fill="${C.onForm}" text-anchor="middle">${form[0]}</text>`,
        );
      }
      if (card.level) {
        const ls = w > 60 ? 13 : 10.5;
        const lw = f.bold.width(String(card.level), ls) + 14;
        const lh = ls + 7;
        push(
          `<rect x="${cx + (w - lw) / 2}" y="${cy + h - lh / 2}" width="${lw}" height="${lh}" rx="6" fill="${C.ground}" stroke="${C.line}"/>`,
        );
        push(
          `<text x="${cx + w / 2}" y="${cy + h + ls / 2 - 1.5}" font-family="Inter" font-size="${ls}" font-weight="700" fill="${C.body}" text-anchor="middle">${card.level}</text>`,
        );
      }
    });
}

/** Words into lines no wider than `max`. */
function wrap(text, metrics, size, max) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && metrics.width(next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The modes' dot, when the session was one mode. */
const sessionDot = (f) => {
  const modes = Object.keys(f.by_mode ?? {});
  return modes.length === 1 ? (MODE_DOT[modes[0]] ?? C.faint) : C.faint;
};

/** The SVG for one session's card (2026-11-17; exported for the tests):
 *  the player's game name, the session's headline, its figures and the
 *  strip of its battles in the order played, the chips, and its most
 *  played deck as the game lays it out. The art is drawn as the file has
 *  it: nothing over it, around it or through it (DECISIONS "Card art"),
 *  so unlike the battle's picture it carries no form ribbon or level. A
 *  card with no art is its name in the frame. The foot is the page's link
 *  and the fan-content line. Every string is escaped by text() as it is
 *  written. */
export function drawSession(read, f) {
  const { player, item } = read;
  const facts = item.facts ?? {};
  const out = [GROUND];
  const push = (s) => out.push(s);
  const LEFT_W = 600;

  // ---- the bar: wordmark, the modes, when it started
  push(
    text(PAD, 62, "Elixir", { family: "Clash", size: 38, fill: "url(#gold)" }),
  );
  const x = PAD + f.clash.width("Elixir", 38) + 22;
  const when = facts.started_at
    ? whenAt(facts.started_at, null, { now: 0 })
    : null;
  const whenW = when ? f.regular.width(when, 17) : 0;
  const modes = modesSaid(facts);
  if (modes) {
    const label = fit(modes, f.regular, 17, RIGHT_X - whenW - 40 - x - 50);
    const w = 34 + f.regular.width(label, 17) + 16;
    push(
      `<rect x="${x}" y="33" width="${w}" height="36" rx="18" fill="${C.panel}" stroke="${C.line}"/>`,
    );
    push(
      `<rect x="${x + 15}" y="46" width="10" height="10" rx="3" fill="${sessionDot(facts)}"/>`,
    );
    push(text(x + 34, 57, label, { size: 17 }));
  }
  if (when)
    push(text(RIGHT_X, 57, when, { size: 17, fill: C.faint, anchor: "end" }));
  push(
    `<line x1="0" y1="88" x2="${SHARE_WIDTH}" y2="88" stroke="${C.lineSoft}"/>`,
  );

  // ---- who, and the headline in up to two lines
  push(
    text(PAD, 148, fit(player.name ?? player.tag, f.bold, 34, LEFT_W), {
      size: 34,
      weight: 700,
      fill: C.ink,
    }),
  );
  const lines = wrap(sessionHeadline(facts), f.bold, 28, LEFT_W);
  const shown = lines.slice(0, 2);
  if (lines.length > 2)
    shown[1] = fit(`${lines.slice(1).join(" ")}`, f.bold, 28, LEFT_W);
  shown.forEach((line, k) =>
    push(
      text(PAD, 196 + k * 36, line, { size: 28, weight: 700, fill: C.gold }),
    ),
  );

  // ---- the figures, as the page's summary has them
  const net = trophyNet(facts);
  const figures = [
    ["BATTLES", String(facts.battles ?? 0), C.ink],
    ["WON", String(facts.won ?? 0), C.win],
    ["LOST", String(facts.lost ?? 0), C.ink],
    ...((facts.drawn ?? 0) > 0 ? [["DRAWN", String(facts.drawn), C.ink]] : []),
    ...(net !== null
      ? [
          [
            "TROPHIES",
            signedCount(net),
            net > 0 ? C.win : net < 0 ? C.loss : C.ink,
          ],
        ]
      : []),
  ];
  const fy = 196 + shown.length * 36 + 28;
  figures.forEach(([label, value, fill], k) => {
    const fx = PAD + k * 120;
    push(text(fx, fy, label, { size: 12, fill: C.faint, spacing: 1 }));
    push(text(fx, fy + 38, value, { size: 34, weight: 700, fill }));
  });

  // ---- the strip: one bar per battle in the order played, up for a
  // win, down for a loss, its height the crown margin; a draw a tick, a
  // battle with no crowns recorded a short faint bar.
  const spark = Array.isArray(item.spark) ? item.spark : [];
  const base = fy + 112;
  if (spark.length > 1) {
    const gap = spark.length > 40 ? 2 : 4;
    const bw = Math.max(
      2,
      Math.min(16, (LEFT_W - gap * (spark.length - 1)) / spark.length),
    );
    push(
      `<line x1="${PAD}" y1="${base}" x2="${PAD + LEFT_W}" y2="${base}" stroke="${C.lineSoft}"/>`,
    );
    spark.slice(0, 200).forEach((b, k) => {
      const bx = (PAD + k * (bw + gap)).toFixed(1);
      if (b.r === "d") {
        push(
          `<rect x="${bx}" y="${base - 2}" width="${bw.toFixed(1)}" height="4" fill="${C.faint}"/>`,
        );
        return;
      }
      const h = b.m == null ? 8 : b.m * 12;
      const fill = b.r === "w" ? C.win : C.loss;
      push(
        `<rect x="${bx}" y="${b.r === "w" ? base - h - 2 : base + 2}" width="${bw.toFixed(1)}" height="${h}" rx="1.5" fill="${fill}"${b.m == null ? ' opacity="0.45"' : ""}/>`,
      );
    });
  }

  // ---- the chips: facts, never a verdict
  const chips = sessionChips(facts, item.scores ?? null).map((c) => c.text);
  let cx = PAD;
  const cy = base + 60;
  for (const chip of chips) {
    const label = fit(chip, f.regular, 16, LEFT_W - (cx - PAD) - 28);
    const w = f.regular.width(label, 16) + 28;
    if (cx + w > PAD + LEFT_W) break;
    push(
      `<rect x="${cx}" y="${cy - 22}" width="${w}" height="32" rx="16" fill="${C.panel}" stroke="${C.line}"/>`,
    );
    push(text(cx + 14, cy, label, { size: 16, fill: C.body }));
    cx += w + 10;
  }

  // ---- the deck played most, its art as the file has it
  const deck = item.deck ?? topDeck(read.games);
  const cardW = 96;
  const gridW = deckWidth(4, cardW, 12);
  const gx = RIGHT_X - gridW;
  const caption = deckCaption(facts);
  const label = deck?.label ?? caption?.label ?? null;
  push(
    text(gx, 134, fit(label ?? "The deck", f.bold, 20, gridW), {
      size: 20,
      weight: 700,
      fill: C.ink,
    }),
  );
  drawPlainDeck(push, f, deck, { x: gx, y: 152, w: cardW, gap: 12 });
  const count =
    caption && caption.label === label && caption.count
      ? `Played in ${caption.count}`
      : null;
  if (count)
    push(
      text(gx, 152 + 2 * Math.round(cardW * CARD_RATIO) + 12 + 34, count, {
        size: 16,
        fill: C.dim,
      }),
    );

  // ---- the foot: the page's link and the disclaimer
  push(
    `<line x1="0" y1="578" x2="${SHARE_WIDTH}" y2="578" stroke="${C.lineSoft}"/>`,
  );
  // The session's address is too long to sit beside the disclaimer, and
  // a cut one leads nowhere: the picture names the site, and the post or
  // chat it travels in carries the link.
  if (read.url)
    push(
      text(PAD, 612, new URL(read.url).host, {
        size: 18,
        weight: 700,
        fill: C.link,
      }),
    );
  const cut = DISCLAIMER.indexOf(". ") + 1;
  push(
    text(RIGHT_X, 600, DISCLAIMER.slice(0, cut), {
      size: 12,
      fill: C.faint,
      anchor: "end",
    }),
  );
  push(
    text(RIGHT_X, 617, DISCLAIMER.slice(cut).trim(), {
      size: 12,
      fill: C.faint,
      anchor: "end",
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">${out.join("\n")}</svg>`;
}

/** The player's deck that played most of the sitting, from the games'
 *  read (its session-wide counts), when the item names none: a sitting
 *  whose decks carry no archetype still shows the cards it played. */
function topDeck(games) {
  let best = null;
  for (const d of games?.decks ?? [])
    if (
      Number.isInteger(d?.battles) &&
      d.cards?.length &&
      (!best || d.battles > best.battles)
    )
      best = d;
  return best;
}

/** A deck in the game's 2 by 4, each card's art and nothing over it. */
function drawPlainDeck(push, f, deck, { x, y, w, gap, slots = true }) {
  const h = Math.round(w * CARD_RATIO);
  const rowGap = 12;
  if (!deck?.cards?.length) {
    push(
      `<rect x="${x}" y="${y}" width="${deckWidth(4, w, gap)}" height="${2 * h + rowGap}" rx="12" fill="none" stroke="${C.lineStrong}" stroke-dasharray="6 5"/>`,
    );
    push(
      text(x + deckWidth(4, w, gap) / 2, y + h + 6, "No deck recorded", {
        size: 16,
        fill: C.faint,
        anchor: "middle",
      }),
    );
    return;
  }
  const shown = slots ? deckDisplayCards(deck.cards) : deck.cards;
  shown.slice(0, 8).forEach((card, k) => {
    const cx = x + (k % 4) * (w + gap);
    const cy = y + Math.floor(k / 4) * (h + rowGap);
    const art = f.art.get(`${card.id}:${card.form ?? "base"}`);
    if (art) {
      push(
        `<image x="${cx}" y="${cy}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${art}"/>`,
      );
      return;
    }
    push(
      `<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${w - 1}" height="${h - 1}" rx="8" fill="${C.raised}" stroke="${C.lineStrong}" stroke-dasharray="4 3"/>`,
    );
    const lines = wrap(card.name ?? "", f.regular, 12, w - 8).slice(0, 3);
    lines.forEach((line, n) =>
      push(
        text(
          cx + w / 2,
          cy + h / 2 - ((lines.length - 1) * 14.4) / 2 + n * 14.4 + 4,
          line,
          { size: 12, fill: C.dim, anchor: "middle" },
        ),
      ),
    );
  });
}

/** One item, no comments, history, reader identity or private Clan state. */
export function drawItem(read, f) {
  const { item, url } = read;
  if (item.kind === "battle")
    return drawBattle(
      { ...item, battle: { ...item.battle, url, image: `${url}.png` } },
      f,
    );
  if (SITTINGS.has(item.kind))
    return drawSession(
      {
        item,
        url,
        player: {
          tag: item.subject_tag,
          name: item.subjects?.find((s) => s.kind === "player")?.name,
        },
        games: { decks: [] },
      },
      f,
    );
  if (
    item.post?.battle &&
    item.post?.versus?.mine &&
    item.post?.versus?.theirs
  ) {
    const p = item.post;
    const b = p.battle;
    const out = [
      GROUND,
      text(PAD, 62, "Elixir", {
        family: "Clash",
        size: 38,
        fill: "url(#gold)",
      }),
    ];
    const words = wrap(
      p.text || item.text || "A battle shared on Elixir",
      f.regular,
      25,
      1090,
    );
    words
      .slice(0, 2)
      .forEach((line, i) =>
        out.push(
          text(
            PAD,
            115 + i * 33,
            i === 1 && words.length > 2
              ? fit(words.slice(1).join(" "), f.regular, 25, 1090)
              : line,
            { size: 25 },
          ),
        ),
      );
    out.push(
      text(
        260,
        213,
        fit(
          p.author?.name ?? p.author?.player_tag ?? "Player",
          f.bold,
          23,
          360,
        ),
        { size: 23, weight: 700, anchor: "middle", fill: C.ink },
      ),
    );
    out.push(
      text(
        930,
        213,
        fit(
          b.opponents?.map((o) => o.name ?? o.player_tag).join(" and ") ??
            "Opponent",
          f.bold,
          23,
          360,
        ),
        { size: 23, weight: 700, anchor: "middle", fill: C.ink },
      ),
    );
    drawPlainDeck((s) => out.push(s), f, p.versus.mine, {
      x: 94,
      y: 240,
      w: 78,
      gap: 6,
    });
    drawPlainDeck((s) => out.push(s), f, p.versus.theirs, {
      x: 764,
      y: 240,
      w: 78,
      gap: 6,
    });
    if (typeof b.crowns === "number" && typeof b.crowns_against === "number")
      out.push(
        text(600, 345, `${b.crowns}–${b.crowns_against}`, {
          size: 46,
          weight: 700,
          anchor: "middle",
          fill: C.gold,
        }),
      );
    const mode = MODE_LABEL[b.mode_group] ?? b.game_mode?.name;
    if (mode)
      out.push(
        text(600, 385, fit(mode, f.regular, 19, 280), {
          size: 19,
          anchor: "middle",
        }),
      );
    out.push(
      text(PAD, 548, fit(url, f.regular, 19, 1090), { size: 19, fill: C.link }),
    );
    out.push(
      text(PAD, 596, fit(DISCLAIMER, f.regular, 12, 1090), {
        size: 12,
        fill: C.dim,
      }),
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${out.join("\n")}</svg>`;
  }
  const deck =
    item.post?.deck ??
    item.deck ??
    (item.post?.cards?.length ? { cards: item.post.cards } : null);
  const out = [GROUND];
  out.push(
    text(PAD, 66, "Elixir", { family: "Clash", size: 38, fill: "url(#gold)" }),
  );
  const who =
    item.subjects?.find((s) => s.kind === "player") ?? item.subjects?.[0];
  out.push(
    text(
      PAD,
      130,
      fit(who?.name ?? who?.tag ?? "A Timeline update", f.bold, 30, 1090),
      { size: 30, weight: 700, fill: C.ink },
    ),
  );
  const words =
    item.post?.text ||
    item.text ||
    (item.facts ? sessionHeadline(item.facts) : "Shared on Elixir");
  const max = deck ? 615 : 1090;
  const moment = item.post?.moment;
  const maxLines = moment ? 4 : 9;
  const lines = wrap(words, f.regular, 27, max).slice(0, maxLines);
  lines.forEach((line, i) =>
    out.push(
      text(
        PAD,
        190 + i * 37,
        i === maxLines - 1 ? fit(line, f.regular, 27, max) : line,
        {
          size: 27,
        },
      ),
    ),
  );
  if (moment) {
    out.push(text(PAD, 365, "Recorded milestone", { size: 17, fill: C.dim }));
    wrap(moment.text, f.regular, 23, 1090)
      .slice(0, 3)
      .forEach((line, i) =>
        out.push(
          text(PAD, 401 + i * 29, fit(line, f.regular, 23, 1090), { size: 23 }),
        ),
      );
    out.push(
      text(PAD, 500, whenAt(moment.at, null, { now: 0 }), {
        size: 17,
        fill: C.dim,
      }),
    );
  }
  if (deck)
    drawPlainDeck((s) => out.push(s), f, deck, {
      slots: !item.post?.cards?.length,
      x: 730,
      y: 180,
      w: 91,
      gap: 10,
    });
  out.push(
    text(PAD, 548, fit(url, f.regular, 19, 1090), { size: 19, fill: C.link }),
  );
  out.push(
    text(PAD, 596, fit(DISCLAIMER, f.regular, 12, 1090), {
      size: 12,
      fill: C.dim,
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${out.join("\n")}</svg>`;
}
