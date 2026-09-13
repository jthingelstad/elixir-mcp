import { QueryClient } from "@tanstack/react-query";
import { transportFailed } from "./envelope.ts";

/**
 * One QueryClient shape for every surface.
 *
 * Retry is the console's old /api/me rule made general: one quiet retry
 * after 1.5 s when the request never got an answer, none when it did -
 * a 401 or a 403 is the answer, and asking again is how a refused
 * session turns into a loop. Data stays fresh for a minute, so leaving
 * a page and coming back does not refetch cold; a window regaining
 * focus refetches anything stale, which on a console people leave open
 * is the difference between a live reading and a stale one.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          failureCount < 1 && transportFailed(error),
        retryDelay: 1500,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        // The envelope never rejects; ApiError does, and only through
        // unwrap(). A view that wants the raw envelope gets it as data.
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
