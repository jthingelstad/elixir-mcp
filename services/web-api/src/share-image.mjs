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
import { fontMetrics } from "./font-metrics.mjs";

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
  ranked: "Path of Legends",
  war: "War",
  casual: "Friendly",
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

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

  return async function render(read) {
    const f = await load();
    const art = await artFor(read, cardArt);
    const svg = drawBattle(read, { ...f, art });
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
  for (const side of read.sides)
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

/** The SVG for one battle (exported for the tests, which read it). */
export function drawBattle(read, f) {
  const { battle, sides, games } = read;
  const [l, r] = sides;
  const last = games?.length ? games[games.length - 1] : null;
  const out = [];
  const push = (s) => out.push(s);

  // A line of text no wider than `max`, shortened with an ellipsis.
  const fit = (text, metrics, size, max) => {
    const s = String(text);
    if (metrics.width(s, size) <= max) return s;
    let cut = s;
    while (cut.length > 1 && metrics.width(`${cut}…`, size) > max)
      cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };
  const text = (x, y, s, o = {}) =>
    `<text x="${x}" y="${y}" font-family="${o.family ?? "Inter"}" font-size="${o.size ?? 16}"${o.weight ? ` font-weight="${o.weight}"` : ""} fill="${o.fill ?? C.body}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${o.raw ? s : esc(s)}</text>`;

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
  const when = `${WHEN.format(new Date(battle.battle_time))} UTC`;
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
  const crowns = games
    ? [
        games.filter((g) => g.winner === "left").length,
        games.filter((g) => g.winner === "right").length,
      ]
    : [l.crowns, r.crowns];
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
      text(MID_X, y, `games · crowns ${l.crowns ?? "?"}–${r.crowns ?? "?"}`, {
        size: 15,
        fill: C.dim,
        anchor: "middle",
      }),
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
  if (battle.url)
    push(
      text(PAD, 612, battle.url.replace(/^https:\/\//, ""), {
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
      ["4-CARD CYCLE", deck?.cycle4 ?? "—"],
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

  // The three towers: hitpoints left, as the game reports them (never
  // "left" and "right": position carries no lane).
  const tiles = towers
    ? [
        ["King Tower", towers.king ?? null],
        ...(towers.princess ?? []).map((v) => ["Princess Tower", v ?? null]),
      ]
    : [];
  const ty = 470;
  const tw = (SIDE_W - 20) / 3;
  tiles.slice(0, 3).forEach(([label, hp], k) => {
    const tx = isLeft ? x0 + k * (tw + 10) : RIGHT_X - (3 - k) * (tw + 10) + 10;
    const down = hp === 0;
    push(
      `<rect x="${tx}" y="${ty}" width="${tw}" height="64" rx="10" fill="${down ? C.ground : C.panel}" stroke="${down ? C.lineSoft : C.line}"/>`,
    );
    push(text(tx + 14, ty + 24, label, { size: 13, fill: C.faint }));
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
  deck.cards.slice(0, 8).forEach((card, k) => {
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
