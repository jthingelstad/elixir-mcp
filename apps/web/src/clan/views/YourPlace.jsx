import { ErrorState } from "@elixir-mcp/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { keys, useInvalidate, useMyPlace } from "../lib/queries.js";
import { placeLabel } from "../lib/place-label.js";
import { trackEvent } from "../../analytics.js";

// The place lists load with the picker, in the browser only: geo.js reads
// them through Vite's import.meta.glob, which a server render (Settings is
// rendered on the server) does not have.
const lists = () => import("../lib/geo.js").then((m) => m.geo);

/** Who sees a place, in one line, true to the server's rule
 *  (packages/clan/src/manage/social.mjs): the clan map of each clan a
 *  verified player of yours is in, to its verified members, while its
 *  leaders keep the map on. */
export const PLACE_WHO =
  "Who sees it: your clan’s verified members, on the clan map, when its leaders have the map on.";

/**
 * Your place (Social, 2026-09-26): one place per person, picked from the
 * lists (a country, its region and, if they like, a city: never an
 * address, never the device's location), set or removed by you alone.
 *
 * It is the person's, not a clan's (2026-11-14): the route needs a
 * verified player and nothing else, so a person with no clan, or whose
 * clan's leaders have the map off, sets it all the same. Three places
 * draw it: Home's profile list (the map step, inline), Settings › Profile
 * (Your place, its permanent home; `setting`) and a clan's map
 * (Members › Map; `clanTag`, the map to redraw). Settings › What members
 * see links to Profile's. It carries no Leaflet, so Settings loads none.
 *
 * `verify` is what to show a person with no verified player (the place
 * route answers 403 `unverified`): the page that draws it knows where its
 * reader verifies one. `open` starts with the picker open (Profile's
 * #place, the passport's On the Map), `onSaved` hears a save that
 * succeeded and `onCancel` a picker closed without one (Home's step).
 */
export function YourPlace({
  clanTag = null,
  verify = null,
  setting = false,
  open = false,
  onSaved = null,
  onCancel = null,
}) {
  const { state, load } = useMyPlace();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(open);
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const place = state.data?.place ?? null;
  // A place saved or removed can latch the map step and earn On the Map
  // (the server's hook): the passport and the bell read again.
  const done = () => {
    invalidate(keys.place);
    invalidate(["me", "passport"], { exact: true });
    invalidate(["me", "bell"], { exact: true });
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
      <ErrorState
        title="Your place could not be read just now"
        onRetry={() => load()}
        busy={state.loading}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (!state.data)
    return (
      <p className="m-0 text-ink-faint" role="status">
        Reading your place.
      </p>
    );
  const remove = async () => {
    setRemoving(true);
    setRemoveError("");
    const r = await api.clearMyPlace();
    setRemoving(false);
    if (!r?.ok)
      return setRemoveError(
        r?.data?.message ?? "Your place could not be removed. Try again.",
      );
    trackEvent("clan.place_cleared");
    done();
  };
  if (!editing && (place || setting))
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {setting ? (
              place ? (
                <strong>{placeLabel(place)}</strong>
              ) : (
                "Not set"
              )
            ) : (
              <>
                You&rsquo;re on the map at <strong>{placeLabel(place)}</strong>
              </>
            )}
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className={place ? "btn btn--sm" : "btn btn--sm btn--primary"}
              aria-label={place ? "Change your place" : "Set your place"}
              onClick={() => setEditing(true)}
            >
              {place ? "Change" : "Set"}
            </button>
            {place ? (
              <button
                type="button"
                className="btn btn--sm"
                aria-label="Remove your place"
                disabled={removing}
                onClick={remove}
              >
                {setting ? "Remove" : "Remove me"}
              </button>
            ) : null}
            {onCancel ? (
              <button type="button" className="btn btn--sm" onClick={onCancel}>
                Close
              </button>
            ) : null}
          </span>
        </div>
        {removeError ? (
          <p className="field-error m-0" role="alert">
            {removeError}
          </p>
        ) : null}
        {setting ? (
          <p className="page-head__note m-0">
            A country, a region or a city, never closer. {PLACE_WHO}
          </p>
        ) : null}
      </div>
    );
  const cancel =
    place || setting
      ? () => {
          setEditing(false);
          onCancel?.();
        }
      : onCancel;
  return (
    <PlacePicker
      initial={place}
      focus={editing || Boolean(onCancel)}
      onCancel={cancel}
      onSaved={(saved) => {
        trackEvent("clan.place_set", saved.precision);
        done();
        onSaved?.(saved);
      }}
    />
  );
}

/**
 * The picker itself: a country, its region where it has them, and an
 * optional city, from the lists. `focus` puts the keyboard on the first
 * list when it opens, for a picker someone just asked for; Escape is
 * Cancel where there is one.
 */
function PlacePicker({ initial, focus = false, onCancel, onSaved }) {
  const id = useId();
  const first = useRef(null);
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
  useEffect(() => {
    if (focus) first.current?.focus();
  }, [focus]);
  const needsRegion = Boolean(data?.regions.length);
  const titleId = `${id}-title`;
  // Escape on any list is Cancel, where there is one.
  const escape = (e) => {
    if (e.key === "Escape" && onCancel) {
      e.stopPropagation();
      onCancel();
    }
  };
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
        A country, a region or a city, from the lists. {PLACE_WHO} You can
        remove it any time.
      </p>
      <label className="field-label" htmlFor={`${id}-country`}>
        Country
      </label>
      <select
        id={`${id}-country`}
        ref={first}
        className="input"
        onKeyDown={escape}
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
          <label className="field-label" htmlFor={`${id}-region`}>
            State or region
          </label>
          <select
            id={`${id}-region`}
            className="input"
            onKeyDown={escape}
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
          <label className="field-label" htmlFor={`${id}-city`}>
            City <span className="page-head__note">(optional)</span>
          </label>
          <select
            id={`${id}-city`}
            className="input"
            onKeyDown={escape}
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
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
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
