/** Elixir did not answer the session read: not signed out, and the page
 *  says so with a way to try again. Home, Settings and Clan share it. */
export function Unavailable({ onRetry, busy }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-[400px] text-center">
        <h1 className="page__title text-[24px]">Elixir didn&rsquo;t answer</h1>
        <p className="text-[13px] text-ink-faint">
          The page could not check who you are. You are not signed out; the
          request did not get through. Try again in a moment.
        </p>
        <button className="btn mt-2" onClick={onRetry} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </button>
      </div>
    </div>
  );
}
