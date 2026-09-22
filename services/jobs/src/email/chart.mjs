/** The season chart, drawn as a PNG with no dependency.
 *
 *  Mail cannot run a chart library and the VPC cannot fetch one, so the
 *  bars are rasterised into an RGBA buffer and deflated into a PNG by
 *  hand - node's zlib is the only thing needed. It is about a hundred
 *  lines because a bar chart is rectangles; anything that needed real
 *  typography would not be worth this and would belong in the site.
 *
 *  The numbers are NOT read from the picture: the alt text carries the
 *  whole series, which is what a screen reader and an image-blocking
 *  client get, and the brief carries it for the writer. A chart nobody
 *  can read is decoration, and decoration does not go in this mail. */
import { deflateSync } from "node:zlib";

const RGB = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
// packages/design tokens, the mail's own palette.
const GROUND = RGB("#1a1440");
const BAR = RGB("#4c3f96");
const BAR_ON = RGB("#f5c84c");
const AXIS = RGB("#3a3175");

/** A 3x5 digit font, one bit per pixel, for the season labels. Digits
 *  and a hyphen are the whole alphabet a YYYY-MM axis needs. */
const GLYPHS = {
  0: [0b111, 0b101, 0b101, 0b101, 0b111],
  1: [0b010, 0b110, 0b010, 0b010, 0b111],
  2: [0b111, 0b001, 0b111, 0b100, 0b111],
  3: [0b111, 0b001, 0b111, 0b001, 0b111],
  4: [0b101, 0b101, 0b111, 0b001, 0b001],
  5: [0b111, 0b100, 0b111, 0b001, 0b111],
  6: [0b111, 0b100, 0b111, 0b101, 0b111],
  7: [0b111, 0b001, 0b010, 0b010, 0b010],
  8: [0b111, 0b101, 0b111, 0b101, 0b111],
  9: [0b111, 0b101, 0b111, 0b001, 0b111],
  "-": [0b000, 0b000, 0b111, 0b000, 0b000],
};

function canvas(w, h, bg) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  return {
    w,
    h,
    px,
    rect(x0, y0, rw, rh, c) {
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++)
        for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) {
          const i = (y * w + x) * 4;
          px[i] = c[0];
          px[i + 1] = c[1];
          px[i + 2] = c[2];
        }
    },
    text(x0, y0, s, c, scale = 1) {
      let x = x0;
      for (const ch of String(s)) {
        const g = GLYPHS[ch];
        if (g) {
          for (let r = 0; r < 5; r++)
            for (let b = 0; b < 3; b++)
              if (g[r] & (1 << (2 - b)))
                this.rect(x + b * scale, y0 + r * scale, scale, scale, c);
        }
        x += 4 * scale;
      }
    },
  };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[i] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each scanline carries its filter byte (0, none).
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const W = 1120; // 560 CSS pixels at 2x, so it is not soft on a phone
const H = 440;

/** One bar per recorded season, the current one picked out. `series` is
 *  [{season_month, usage_share_pct}]; `highlight` the month to pick out. */
export function seasonChart(series, highlight) {
  const rows = (series ?? []).filter((r) => r.usage_share_pct != null);
  if (rows.length === 0) return null;
  const c = canvas(W, H, GROUND);
  const padL = 24;
  const padB = 56;
  const padT = 24;
  const top = Math.max(...rows.map((r) => r.usage_share_pct)) || 1;
  // A round ceiling above the tallest bar, so the shape is not flattered.
  const ceil = Math.ceil(top / 10) * 10 || 10;
  const plotH = H - padT - padB;
  const slot = Math.floor((W - padL * 2) / rows.length);
  const barW = Math.max(8, Math.floor(slot * 0.62));
  c.rect(padL, H - padB, W - padL * 2, 2, AXIS);
  rows.forEach((r, i) => {
    const bh = Math.round((r.usage_share_pct / ceil) * plotH);
    const x = padL + i * slot + Math.floor((slot - barW) / 2);
    const on = r.season_month === highlight;
    c.rect(x, H - padB - bh, barW, bh, on ? BAR_ON : BAR);
    // YYYY-MM stacked as MM under the axis; the year would not fit.
    c.text(
      x + Math.floor(barW / 2) - 10,
      H - padB + 14,
      String(r.season_month).slice(5),
      on ? BAR_ON : AXIS,
      3,
    );
  });
  return png(c);
}

/** What the picture says, for a reader who does not get the picture.
 *  This is the honest surface: the series in words. */
export function seasonChartAlt(series, cardName) {
  const rows = (series ?? []).filter((r) => r.usage_share_pct != null);
  if (rows.length === 0) return null;
  const parts = rows.map(
    (r) => `${r.season_month} ${r.usage_share_pct.toFixed(1)} percent`,
  );
  return `${cardName} usage share by season: ${parts.join(", ")}.`;
}
