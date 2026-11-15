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
 *  leaders keep the map on; and, only when its owner chose it (#768), the
 *  player map and Near you, to people signed in to Elixir. */
export const PLACE_WHO =
  "Who sees it: your clan’s verified members, on the clan map, when its leaders have the map on.";
export const PLACE_WHO_WIDE =
  "Who sees it: your clan’s verified members, on the clan map, and anyone signed in to Elixir, on the player map and in Near you.";

/** The two reaches a place can have (#768), as the picker offers them. */
export const REACH_WIDE = "My clan maps, the player map and Near you";
export const REACH_CLAN = "My clan maps only";

/** A place's reach in one line, from its `player_map` (true, false, or
 *  null for a place saved before the choice existed: clan maps only). */
export const reachLine = (playerMap) =>
  playerMap === true
    ? "On your clan maps, the player map and Near you."
    : "On your clan maps only.";

/** Join or leave the player map, keeping the place (#768). */
export function usePlayerMapChoice() {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async (playerMap) => {
    setBusy(true);
    setError("");
    const r = await api.setPlayerMap(playerMap);
    setBusy(false);
    if (!r?.ok) {
      setError(r?.data?.message ?? "That did not work. Try again.");
      return false;
    }
    trackEvent(playerMap ? "clan.player_map_joined" : "clan.player_map_left");
    invalidate(keys.place);
    invalidate(["me", "people", "near"], { exact: true });
    invalidate(["me", "player-map"], { exact: true });
    return true;
  };
  return { choose, busy, error };
}

/** Under a saved place: where it shows, and the way on or off the player
 *  map. A place saved before the choice existed asks once, in words, and
 *  stays on clan maps only until its owner says yes. */
function PlaceReach({ place }) {
  const { choose, busy, error } = usePlayerMapChoice();
  const asked = place.player_map === true || place.player_map === false;
  return (
    <div className="grid gap-2">
      {asked ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="page-head__note">{reachLine(place.player_map)}</span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => choose(!place.player_map)}
          >
            {place.player_map ? "Leave the player map" : "Join the player map"}
          </button>
        </div>
      ) : (
        <div className="callout" role="note">
          <div className="grid gap-2">
            <strong>New: the player map</strong>
            <span>
              Your place can also go on the player map and in Near you, where
              anyone signed in to Elixir can find players near them. Only your
              place shows, never closer. It stays on your clan maps only unless
              you say yes.
            </span>
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn--sm btn--primary"
                disabled={busy}
                onClick={() => choose(true)}
              >
                Join the player map
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => choose(false)}
              >
                Keep clan maps only
              </button>
            </span>
          </div>
        </div>
      )}
      {error ? (
        <p className="field-error m-0" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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
  // A new opening request (Profile's hash turning to #place again, as
  // Back does) opens the picker even with this view still mounted.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setEditing(true);
  }
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
        {place ? <PlaceReach place={place} /> : null}
        {setting ? (
          <p className="page-head__note m-0">
            A country, a region or a city, never closer.{" "}
            {place?.player_map === true ? PLACE_WHO_WIDE : PLACE_WHO}
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
  // Who sees it (#768). A new place starts on the player map, said in
  // plain words beside the choice; a saved one keeps what its owner chose,
  // so a place never asked about is never widened by a change.
  const [wide, setWide] = useState(
    initial ? initial.player_map === true : true,
  );
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
          player_map: wide,
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
        A country, a region or a city, from the lists, never closer. You can
        change or remove it any time.
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
      <fieldset className="grid gap-1">
        <legend className="field-label">Who sees it</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name={`${id}-reach`}
            checked={wide}
            onChange={() => setWide(true)}
          />
          <span>
            {REACH_WIDE}
            <span className="page-head__note block">
              Your clan&rsquo;s verified members, and anyone signed in to Elixir
              looking for players near them.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name={`${id}-reach`}
            checked={!wide}
            onChange={() => setWide(false)}
          />
          <span>
            {REACH_CLAN}
            <span className="page-head__note block">
              Only your clan&rsquo;s verified members, when its leaders have the
              map on.
            </span>
          </span>
        </label>
      </fieldset>
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
