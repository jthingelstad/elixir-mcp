/** Enough PNG to read Supercell's card art, shrink it to the sizes mail
 *  asks for, and write it back. No dependency: node's zlib does the
 *  compression and the rest is the format.
 *
 *  Written rather than pulled in because the alternative is a native
 *  image library in a repo that has none, or shelling out to a macOS
 *  tool and making the card art buildable on exactly one machine. A
 *  box-filter downscale of a 285x420 card to 64px is about forty lines
 *  and produces a smaller, sharper file than either. */
import { inflateSync, deflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** {w, h, px} with px as RGBA, from a truecolour PNG. Palette and
 *  interlace are not supported and say so: the card art is neither. */
export function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} not supported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`colour type ${colour} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    // Undo the scanline filter (PNG spec 9.2), in place.
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] =
          (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 4;
      if (channels >= 3) {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = channels === 2 ? line[s + 1] : 255;
      }
    }
    prev = line;
  }
  return { w, h, px: out };
}

/** Filter one scanline five ways and keep the cheapest, by the sum of
 *  absolute differences the spec suggests. Writing every line unfiltered
 *  is legal and roughly doubles the file: card art is smooth, so Paeth
 *  and Up predict it well. */
function filterLine(line, prev, stride, bpp) {
  const cand = [];
  for (let f = 0; f < 5; f++) {
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      out[i] =
        f === 0
          ? x
          : f === 1
            ? (x - a) & 0xff
            : f === 2
              ? (x - b) & 0xff
              : f === 3
                ? (x - ((a + b) >> 1)) & 0xff
                : (() => {
                    const pa = Math.abs(b - c);
                    const pb = Math.abs(a - c);
                    const pc = Math.abs(a + b - 2 * c);
                    return (
                      (x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
                    );
                  })();
    }
    let sum = 0;
    for (const v of out) sum += v < 128 ? v : 256 - v;
    cand.push({ f, out, sum });
  }
  return cand.reduce((m, x) => (x.sum < m.sum ? x : m));
}

export function encode({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = px.subarray(y * stride, (y + 1) * stride);
    const best = filterLine(line, prev, stride, 4);
    raw[y * (stride + 1)] = best.f;
    best.out.copy(raw, y * (stride + 1) + 1);
    prev = line;
  }
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Box-filter downscale, alpha-weighted so a transparent edge does not
 *  drag colour into the visible pixels. Height follows from the source
 *  aspect: card art is 2:3 and must not be squashed into a square. */
export function resize(img, width) {
  const height = Math.max(1, Math.round((width * img.h) / img.w));
  const out = Buffer.alloc(width * height * 4);
  const sx = img.w / width;
  const sy = img.h / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.w + xx) * 4;
          const al = img.px[i + 3];
          r += img.px[i] * al;
          g += img.px[i + 1] * al;
          b += img.px[i + 2] * al;
          a += al;
          n++;
        }
      const d = (y * width + x) * 4;
      out[d] = a ? Math.round(r / a) : 0;
      out[d + 1] = a ? Math.round(g / a) : 0;
      out[d + 2] = a ? Math.round(b / a) : 0;
      out[d + 3] = Math.round(a / n);
    }
  }
  return { w: width, h: height, px: out };
}
