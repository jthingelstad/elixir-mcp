import {
  COLLECTOR_RELEASE_KEYS,
  COLLECTOR_RELEASE_SIGNER,
} from "@elixir-mcp/contracts";
import { Icon } from "@elixir-mcp/ui";
import { useEffect, useState } from "react";
import {
  fingerprintOf,
  keyDigest,
  randomartGrid,
  randomartSymbol,
  randomartText,
} from "../lib/randomart.js";

/**
 * Does a collector run a signed release, and which key signs them.
 *
 * The state is the hub's (0184, packages/collector-door/src/signature.mjs):
 * the binary hash a collector reports against the signed hash named for
 * its version. A collector that sends no hash (an older client) reads
 * `unverified` or, on an older hub, has no state at all; both render.
 */
const STATES = {
  signed: {
    icon: "shield-check",
    label: "signed",
    title:
      "Runs exactly a release the hub named: its binary's SHA-256 is the signed one for its version.",
  },
  dev_build: {
    icon: "wrench",
    label: "dev build",
    title: "A local build (version dev). It cannot match a signed release.",
  },
  unverified: {
    icon: "shield-question-mark",
    label: "unverified",
    title:
      "This collector does not report its binary's hash yet; releases from v3.0.4 do.",
  },
  mismatch: {
    icon: "shield-x",
    label: "mismatch",
    title:
      "Reports a binary hash that is not the signed release for its version: a local build, or something wrong.",
  },
};

/** `iconOnly` is the phone's mark beside a collector's name, where the
 *  version column is behind the table's scroll; the label is its title. */
export function SignatureBadge({ state, iconOnly = false }) {
  const key = state in STATES ? state : "unverified";
  const s = STATES[key];
  return (
    <span
      className={`sig sig--${key}${iconOnly ? " sig--icon" : ""}`}
      title={iconOnly ? `${s.label}: ${s.title}` : s.title}
      aria-label={iconOnly ? s.label : undefined}
    >
      <Icon name={s.icon} size={13} />
      {!iconOnly && s.label}
    </span>
  );
}

/** The digest of a published key, and whether it is the fingerprint
 *  the contracts publish. Null while hashing; `error` where the browser
 *  has no Web Crypto (then there is no picture, and the fingerprint
 *  text still stands). */
function useKeyDigest(key) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true;
    keyDigest(key.line).then(
      (digest) =>
        live &&
        setState({
          digest,
          matches: fingerprintOf(digest) === key.fingerprint,
        }),
      () => live && setState({ error: true }),
    );
    return () => {
      live = false;
    };
  }, [key.line, key.fingerprint]);
  return state;
}

function Randomart({ digest, label }) {
  const grid = randomartGrid(digest);
  return (
    <figure className="randomart" aria-label={label} role="img">
      <div className="randomart__rule" aria-hidden="true">
        <span>ED25519 256</span>
      </div>
      <div className="randomart__board" aria-hidden="true">
        {grid.flatMap((row, y) =>
          row.map((level, x) => (
            <span
              key={`${x}.${y}`}
              className={`randomart__cell randomart__cell--${
                level === 15 ? "start" : level === 16 ? "end" : `l${level}`
              }`}
            >
              {randomartSymbol(level)}
            </span>
          )),
        )}
      </div>
      <div className="randomart__rule" aria-hidden="true">
        <span>SHA256</span>
      </div>
    </figure>
  );
}

function KeyArt({ keyEntry }) {
  const hashed = useKeyDigest(keyEntry);
  if (!hashed) return <div className="randomart randomart--pending" />;
  if (hashed.error) return null;
  if (!hashed.matches)
    // The line and the fingerprint the contracts publish disagree: never
    // draw a picture for a key nobody published.
    return (
      <p className="callout callout--bad">
        This page&rsquo;s release key does not hash to its published
        fingerprint. Do not trust it; tell the maintainer.
      </p>
    );
  return (
    <>
      <Randomart
        digest={hashed.digest}
        label={`SSH randomart of the release key ${keyEntry.fingerprint}`}
      />
      <details className="release-key__ascii">
        <summary>As ssh-keygen -lv prints it</summary>
        <pre>{randomartText(hashed.digest)}</pre>
      </details>
    </>
  );
}

/**
 * The release key, drawn: its randomart and fingerprint beside a line
 * on what the badge means. The same picture an operator gets from
 * `ssh-keygen -lv` over the key in the collector's SECURITY.md or on
 * the operators page, so it can be checked by eye.
 */
export function ReleaseKeyCard({ counts }) {
  return (
    <section className="release-key panel">
      {COLLECTOR_RELEASE_KEYS.map((key) => (
        <div className="release-key__art" key={key.line}>
          <KeyArt keyEntry={key} />
        </div>
      ))}
      <div className="release-key__text">
        <div className="release-key__title">
          <Icon name="fingerprint" size={18} />
          Signed releases
        </div>
        <p>
          Every collector release is signed with this key, and a collector
          installs an update only after checking the signature.{" "}
          <strong>Signed</strong> means the binary a collector reports running
          is, byte for byte, a release the hub named.
        </p>
        {counts && (
          <p className="release-key__counts">
            {Object.keys(STATES)
              .filter((k) => counts[k])
              .map((k) => (
                <span key={k}>
                  <SignatureBadge state={k} /> {counts[k]}
                </span>
              ))}
          </p>
        )}
        {COLLECTOR_RELEASE_KEYS.map((key) => (
          <code className="release-key__fp" key={key.fingerprint}>
            {key.fingerprint}
          </code>
        ))}
        <p className="release-key__foot">
          {COLLECTOR_RELEASE_SIGNER} &middot;{" "}
          <a href="/docs/operators#how-updates-reach-you">check it yourself</a>
        </p>
      </div>
    </section>
  );
}

/** How many collectors are in each state, for the card's tally. */
export function signatureCounts(collectors) {
  const counts = {};
  // No state (a hub from before 0184) is counted nowhere, as the table
  // draws no badge for it.
  for (const c of collectors) {
    if (!(c.signature in STATES)) continue;
    counts[c.signature] = (counts[c.signature] ?? 0) + 1;
  }
  return counts;
}
