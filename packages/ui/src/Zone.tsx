import { createContext, useContext, useMemo, type ReactNode } from "react";
import { stamp, stampDay, stampTime } from "./time.ts";

/** The reader's timezone, set once where the app knows the account and
 *  read by every view that prints a time. Null (no provider, or an
 *  account that never set one) is UTC, which is what the console showed
 *  everywhere before the zone reached it. */
const ZoneContext = createContext<string | null>(null);

export function ZoneProvider({
  zone,
  children,
}: {
  zone?: string | null;
  children: ReactNode;
}) {
  return (
    <ZoneContext.Provider value={zone || null}>{children}</ZoneContext.Provider>
  );
}

/** The clock vocabulary bound to the reader's zone, so a view says
 *  `stamp(r.created_at)` and cannot forget whose clock it is. */
export function useClock() {
  const zone = useContext(ZoneContext);
  return useMemo(
    () => ({
      zone,
      stamp: (
        ts: Parameters<typeof stamp>[0],
        opts?: Parameters<typeof stamp>[2],
      ) => stamp(ts, zone, opts),
      day: (ts: Parameters<typeof stampDay>[0]) => stampDay(ts, zone),
      time: (
        ts: Parameters<typeof stampTime>[0],
        opts?: Parameters<typeof stampTime>[2],
      ) => stampTime(ts, zone, opts),
    }),
    [zone],
  );
}
