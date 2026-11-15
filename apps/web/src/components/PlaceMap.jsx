import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { localTime, placeLabel } from "../clan/lib/geo.js";

/**
 * A map of picked places (the clan map, 2026-09-26, and the player map,
 * #768): one pin per place, at the lists' own point for the city, region
 * or country its owner picked, never closer; members who picked the same
 * place share a pin, and the reader's own is gold. OpenStreetMap tiles.
 * Leaflet touches the window when it loads, so every page that draws this
 * loads it lazily, in the browser only.
 */
/** A token's color, for Leaflet's vector layers (they take values). */
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function PlaceMap({ entries, label }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    map.current = L.map(el.current, { worldCopyJump: true }).setView(
      [20, 0],
      2,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    // One pin per place: members who picked the same one share it.
    const byPin = new Map();
    for (const e of entries) {
      const k = `${e.place.lat},${e.place.lng}`;
      if (!byPin.has(k)) byPin.set(k, []);
      byPin.get(k).push(e);
    }
    const accent = token("--map-pin");
    const deep = token("--map-pin-edge");
    const gold = token("--map-pin-mine");
    for (const group of byPin.values()) {
      const { lat, lng, tz } = group[0].place;
      const you = group.some((e) => e.you);
      const pin = L.circleMarker([lat, lng], {
        radius: 7 + Math.min(group.length, 6) * 2,
        color: deep,
        weight: 2,
        fillColor: you ? gold : accent,
        fillOpacity: 0.85,
      });
      // Built when opened, so the local time is now's, and from text
      // nodes: names are the players', never markup.
      pin.bindPopup(() => {
        const box = document.createElement("div");
        const head = document.createElement("strong");
        head.textContent = `${placeLabel(group[0].place)} · ${localTime(tz).time}`;
        box.appendChild(head);
        for (const e of group) {
          const line = document.createElement("div");
          line.textContent = `${e.name ?? e.player_tag}${e.you ? " (you)" : ""}`;
          box.appendChild(line);
        }
        return box;
      });
      pin.addTo(layer.current);
    }
    if (entries.length)
      map.current.fitBounds(
        L.latLngBounds(entries.map((e) => [e.place.lat, e.place.lng])),
        { padding: [40, 40], maxZoom: 6 },
      );
  }, [entries]);
  return (
    <div
      ref={el}
      className="isolate h-[420px] rounded-panel border border-line"
      aria-label={label}
    />
  );
}
