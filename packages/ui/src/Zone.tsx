import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  calendarDay,
  clockAt,
  dayAt,
  dayHeadingAt,
  feedDayHeadingAt,
  feedWhenAt,
  stamp,
  stampDay,
  stampTime,
  whenAt,
} from "./time.ts";
import { useInitialTime } from "./InitialTime.tsx";

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
 *  `when(r.created_at)` and cannot forget whose clock it is. `when`,
 *  `whenDay` and `calendar` read "now" once for the visit, so a server
 *  render and its hydration agree. `stamp`, `day` and `time` are the wall
 *  clock staff pages keep; member pages use the words. */
export function useClock() {
  const zone = useContext(ZoneContext);
  const [now] = useInitialTime();
  return useMemo(
    () => ({
      zone,
      now,
      when: (ts: Parameters<typeof whenAt>[0]) => whenAt(ts, zone, { now }),
      whenDay: (ts: Parameters<typeof dayAt>[0]) => dayAt(ts, zone, { now }),
      dayHeading: (ts: Parameters<typeof dayHeadingAt>[0]) =>
        dayHeadingAt(ts, zone),
      calendar: (ymd: Parameters<typeof calendarDay>[0]) =>
        calendarDay(ymd, { now }),
      clock: (ts: Parameters<typeof clockAt>[0]) => clockAt(ts, zone),
      /** The feed's words: "Tonight, 7:40 to 8:32 pm" (with `end`). */
      feedWhen: (
        ts: Parameters<typeof feedWhenAt>[0],
        end: Parameters<typeof feedWhenAt>[0] = null,
      ) => feedWhenAt(ts, zone, { now, end }),
      /** The feed's day heading: "Today", "Yesterday", "Monday, November 9". */
      feedDayHeading: (ts: Parameters<typeof feedDayHeadingAt>[0]) =>
        feedDayHeadingAt(ts, zone, { now }),
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
    [zone, now],
  );
}
