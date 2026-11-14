import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { ApiError, unwrap, type Envelope } from "./envelope.ts";

/**
 * One write, the way every surface should make it (review 2026-09-27
 * §7.5). The console awaited 21 of its writes and threw the envelope
 * away, so a refused revoke, suspend or sign-out looked exactly like
 * one that worked: the button came back and nothing said otherwise.
 *
 * `useWrite(call, { invalidate })` unwraps the envelope, so a refusal
 * or a transport failure is an error rather than a quiet `{ ok: false }`;
 * refetches only after a write that SUCCEEDED (a refused write changed
 * nothing, and a fresh read would paint over the refusal); and keeps
 * the error for the kit's `WriteError` to say. `run` never throws: it
 * resolves to `{ ok, data }` or `{ ok: false, error }`, so a caller that
 * navigates after success can branch without a try.
 */
export type WriteResult<T> =
  { ok: true; data: T } | { ok: false; error: ApiError };

export interface WriteOptions<T> {
  /** After a successful write: query keys to refetch, or a function that
   *  refetches (the console passes its scoped `useInvalidate`). */
  invalidate?: QueryKey[] | ((data: T) => unknown);
}

export interface Write<A extends unknown[], T> {
  run: (...args: A) => Promise<WriteResult<T>>;
  busy: boolean;
  /** The last write's failure, until the next run or `reset()`. */
  error: ApiError | null;
  reset: () => void;
}

/** Anything a call threw instead of answering, as the envelope failure it
 *  stands for: the request never got an answer. */
function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError({ ok: false, status: 0, data: {}, error: "network" });
}

export function useWrite<A extends unknown[], T = unknown>(
  call: (...args: A) => Promise<Envelope<T>>,
  options: WriteOptions<T> = {},
): Write<A, T> {
  const queryClient = useQueryClient();
  const { invalidate } = options;
  const mutation = useMutation<T, ApiError, A>({
    mutationFn: async (args) => {
      let envelope: Envelope<T>;
      try {
        envelope = await call(...args);
      } catch (err) {
        throw asApiError(err);
      }
      return unwrap(envelope);
    },
    onSuccess: async (data) => {
      if (typeof invalidate === "function") {
        await invalidate(data);
        return;
      }
      // In-flight reads are cancelled first: a read still pending when
      // the write lands is joined, not refetched, and would paint the
      // state from before the write (the console's useInvalidate).
      for (const queryKey of invalidate ?? []) {
        await queryClient.cancelQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  return {
    run: async (...args: A) => {
      try {
        return { ok: true, data: await mutation.mutateAsync(args) };
      } catch (err) {
        return { ok: false, error: asApiError(err) };
      }
    },
    busy: mutation.isPending,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
