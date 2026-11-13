import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { keys, useInvalidate, useMyPlace } from "../lib/queries.js";
import { placeLabel } from "../lib/place-label.js";
import { trackEvent } from "../../analytics.js";

// The place lists load with the picker, in the browser only: geo.js reads
// them through Vite's import.meta.glob, which a server render (Settings is
// rendered on the server) does not have.
const lists = () => import("../lib/geo.js").then((m) => m.geo);

/**
 * Your place (Social, 2026-09-26): one place per person, picked from the
 * lists (a country, its region and, if they like, a city: never an
 * address, never the device's location), set or removed by you alone.
 *
 * Two pages draw it: a clan's map (Members › Map) and Settings › What
 * members see, as Location (2026-11-12, the canvas's "Your choices"). It
 * carries no Leaflet, so Settings loads none. Who sees it is the server's
 * rule (packages/clan/src/manage/social.mjs): the clan map of each clan a
 * verified player of yours is in, to that clan's verified members, while
 * its leaders keep the map on. Nothing else reads it.
 *
 * `verify` is what to show a person with no verified player (the place
 * route answers 403 `unverified`): the page that draws it knows where its
 * reader verifies one. `clanTag`, on a clan's map, is the map to redraw.
 */
export function YourPlace({ clanTag = null, verify = null }) {
  const { state } = useMyPlace();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const place = state.data?.place ?? null;
  const done = () => {
    invalidate(keys.place);
    if (clanTag) invalidate(keys.map(clanTag));
    setEditing(false);
  };
  if (state.signedOut)
    return <p className="m-0">Sign in again to add or change your place.</p>;
  if (state.forbidden)
    return (
      verify ?? (
        <p className="m-0">
          Verify your player first: a place belongs to a verified player.
        </p>
      )
    );
  if (state.error)
    return (
      <p className="m-0" role="alert">
        Your place did not load. Try again in a minute.
      </p>
    );
  if (!state.data)
    return (
      <p className="m-0 text-ink-faint" role="status">
        Reading your place.
      </p>
    );
  if (place && !editing)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span>
          You&rsquo;re on the map at <strong>{placeLabel(place)}</strong>
        </span>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => {
              await api.clearMyPlace();
              trackEvent("clan.place_cleared");
              done();
            }}
          >
            Remove me
          </button>
        </span>
      </div>
    );
  return (
    <PlacePicker
      initial={place}
      onCancel={place ? () => setEditing(false) : null}
      onSaved={(saved) => {
        trackEvent("clan.place_set", saved.precision);
        done();
      }}
    />
  );
}

function PlacePicker({ initial, onCancel, onSaved }) {
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState(initial?.country ?? "");
  const [data, setData] = useState(null);
  const [region, setRegion] = useState(initial?.region ?? "");
  const [city, setCity] = useState(initial?.city ? String(initial.city) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    lists()
      .then((geo) => geo.countries())
      .then(setCountries);
  }, []);
  useEffect(() => {
    setData(null);
    if (country)
      lists()
        .then((geo) => geo.country(country))
        .then(setData);
  }, [country]);
  const cities = useMemo(
    () =>
      (data?.cities ?? []).filter((c) =>
        data?.regions.length ? c.region === region : true,
      ),
    [data, region],
  );
  const needsRegion = Boolean(data?.regions.length);
  const titleId = "place-form-title";
  return (
    <form
      className="grid gap-2"
      aria-labelledby={titleId}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await api.setMyPlace({
          country,
          region: needsRegion ? region : null,
          city: city ? Number(city) : null,
        });
        setBusy(false);
        if (!r.ok) return setError(r.data?.message ?? "That did not work.");
        onSaved(r.data.place);
      }}
    >
      <strong id={titleId}>
        {initial ? "Change your place" : "Add yourself to the map"}
      </strong>
      <p className="page-head__note m-0">
        A city or just a region, from the list. It shows on the map of every
        clan your verified player is in, to that clan&rsquo;s verified members
        only, and you can remove it any time.
      </p>
      <label className="field-label" htmlFor="place-country">
        Country
      </label>
      <select
        id="place-country"
        className="input"
        value={country}
        onChange={(e) => {
          setCountry(e.target.value);
          setRegion("");
          setCity("");
        }}
      >
        <option value="">Choose…</option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      {needsRegion ? (
        <>
          <label className="field-label" htmlFor="place-region">
            State or region
          </label>
          <select
            id="place-region"
            className="input"
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setCity("");
            }}
          >
            <option value="">Choose…</option>
            {data.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {data && (!needsRegion || region) ? (
        <>
          <label className="field-label" htmlFor="place-city">
            City <span className="page-head__note">(optional)</span>
          </label>
          <select
            id="place-city"
            className="input"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">
              {needsRegion ? "Just the region" : "Just the country"}
            </option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !country || (needsRegion && !region)}
        >
          {initial ? "Save" : "Add me"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
