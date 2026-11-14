import { Tag, Panel, ErrorState } from "@elixir-mcp/ui";
import { PageHead } from "../components/PageHead.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useClanMap } from "../lib/queries.js";
import { localTime, placeLabel } from "../lib/geo.js";
import { YourPlace } from "./YourPlace.jsx";

/**
 * The clan map (Social, Jamie 2026-09-26): where the clan plays from.
 * A member adds a place picked from the lists (a country, its region and,
 * if they like, a city: never an address, never the device's location)
 * and sees everyone else who has, with each one's local time. Only the
 * clan's verified members see it, and it stays in Clan.
 */
export function ClanMap({ clan }) {
  const { state, load } = useClanMap(clan.clan_tag);
  const now = useMinute();
  const d = state.data;
  if (state.forbidden || state.signedOut)
    return (
      <Page>
        <div className="callout callout--warn" role="alert">
          <span>
            The clan map is available to verified current members. Check your
            clan access or sign in again.
          </span>
        </div>
      </Page>
    );
  if (state.error === "social_off")
    return (
      <Page>
        <p className="page__lede">
          This clan&rsquo;s leaders have turned the member map off.
        </p>
      </Page>
    );
  if (state.error)
    return (
      <Page>
        <ErrorState
          title="The clan map could not be read just now"
          onRetry={() => load()}
          busy={state.loading}
        >
          Try again in a moment.
        </ErrorState>
      </Page>
    );
  if (!d) return <p className="page__lede">Reading…</p>;
  return (
    <Page>
      <p className="page__lede m-0">
        Where the clan plays from, and what time it is there. Add your city or
        region to appear; only verified members of{" "}
        {clan.name ?? <Tag tag={clan.clan_tag} />} see this map, and it stays
        here.
      </p>
      <Panel title="Your place" titleAs="h2" pad>
        <YourPlace clanTag={clan.clan_tag} />
      </Panel>
      {d.not_recorded ? (
        <p className="page-head__note">
          Elixir isn&rsquo;t recording this clan yet, so there is no roster to
          place.
        </p>
      ) : (
        <>
          <p className="page-head__note m-0">
            {d.on_map} of {d.members} members on the map
          </p>
          <MapView entries={d.entries} />
          <People entries={d.entries} now={now} />
          <p className="page-head__note m-0">{d.attribution}</p>
        </>
      )}
    </Page>
  );
}

function Page({ children }) {
  return (
    <div className="grid gap-4">
      <PageHead title="Clan map" />
      {children}
    </div>
  );
}

/** The clock the local times read, ticking each minute. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** A token's color, for Leaflet's vector layers (they take values). */
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function MapView({ entries }) {
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
      aria-label="Map of where the clan's members play from"
    />
  );
}

/** Everyone on the map, by country and place, with their local time. */
function People({ entries, now }) {
  const byCountry = useMemo(() => {
    const out = new Map();
    for (const e of [...entries].sort(
      (a, b) =>
        a.place.country_name.localeCompare(b.place.country_name) ||
        placeLabel(a.place).localeCompare(placeLabel(b.place)) ||
        String(a.name).localeCompare(String(b.name)),
    )) {
      if (!out.has(e.place.country_name)) out.set(e.place.country_name, []);
      out.get(e.place.country_name).push(e);
    }
    return [...out];
  }, [entries]);
  if (!entries.length)
    return (
      <p className="page-head__note m-0">
        Nobody has added a place yet. Be the first.
      </p>
    );
  return (
    <Panel as="div">
      <div className="panel__body grid gap-3">
        {byCountry.map(([country, people]) => (
          <div key={country} className="grid gap-1">
            <span className="font-semibold">
              {country} · {people.length}
            </span>
            {people.map((e) => {
              const t = localTime(e.place.tz, now);
              return (
                <span key={e.player_tag} className="page-head__note">
                  {e.name ?? <Tag tag={e.player_tag} />}
                  {e.you ? " (you)" : ""} · {e.role_label ?? e.role} ·{" "}
                  {[e.place.city_name, e.place.region_name]
                    .filter(Boolean)
                    .join(", ") || e.place.country_name}{" "}
                  · {t.time} ({t.away})
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
}
