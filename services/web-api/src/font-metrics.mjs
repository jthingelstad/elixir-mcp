/** How wide a line of text sets in a font, read from the font file's own
 *  advance widths (cmap and hmtx), so the share picture can size a chip
 *  to its words and shorten a name that would run into the score. No
 *  kerning: the picture's fonts carry none (fonts/README.md). */

const tag = (dv, o) =>
  String.fromCharCode(
    dv.getUint8(o),
    dv.getUint8(o + 1),
    dv.getUint8(o + 2),
    dv.getUint8(o + 3),
  );

/** The Unicode subtable to read: format 12 (all planes) over format 4
 *  (the Basic Multilingual Plane), Windows or Unicode platform only. */
function unicodeSubtable(dv, cmap) {
  const count = dv.getUint16(cmap + 2);
  let best = null;
  let rank = -1;
  for (let i = 0; i < count; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = dv.getUint16(rec);
    if (platform !== 0 && platform !== 3) continue;
    const at = cmap + dv.getUint32(rec + 4);
    const format = dv.getUint16(at);
    const r = format === 12 ? 2 : format === 4 ? 1 : -1;
    if (r > rank) {
      rank = r;
      best = at;
    }
  }
  return best;
}

function glyphLookup(dv, at) {
  if (at === null) return () => 0;
  if (dv.getUint16(at) === 12) {
    const groups = dv.getUint32(at + 12);
    return (cp) => {
      for (let i = 0; i < groups; i++) {
        const g = at + 16 + i * 12;
        if (cp < dv.getUint32(g)) return 0;
        if (cp <= dv.getUint32(g + 4))
          return dv.getUint32(g + 8) + (cp - dv.getUint32(g));
      }
      return 0;
    };
  }
  const segX2 = dv.getUint16(at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segX2; i += 2) {
      if (dv.getUint16(ends + i) < cp) continue;
      const start = dv.getUint16(starts + i);
      if (start > cp) return 0;
      const delta = dv.getUint16(deltas + i);
      const range = dv.getUint16(ranges + i);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = dv.getUint16(ranges + i + range + 2 * (cp - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

/** A font file's metrics: `width(text, size)` in pixels at `size`, and
 *  `has(char)` for whether the font draws it. */
export function fontMetrics(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = {};
  const count = dv.getUint16(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    tables[tag(dv, rec)] = dv.getUint32(rec + 8);
  }
  const unitsPerEm = dv.getUint16(tables.head + 18);
  const metrics = dv.getUint16(tables.hhea + 34);
  const advance = (gid) =>
    dv.getUint16(tables.hmtx + 4 * Math.min(gid, metrics - 1));
  const glyph = glyphLookup(dv, unicodeSubtable(dv, tables.cmap));
  return {
    width(text, size) {
      let units = 0;
      for (const ch of String(text)) units += advance(glyph(ch.codePointAt(0)));
      return (units * size) / unitsPerEm;
    },
    has: (ch) => glyph(ch.codePointAt(0)) !== 0,
  };
}
