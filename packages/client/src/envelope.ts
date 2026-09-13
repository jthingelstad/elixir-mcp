/**
 * The envelope every Elixir surface's API client returns. Nothing here
 * throws: a transport failure, an edge error page and a refused request
 * all come back as `{ ok: false }` with a status the view can read,
 * because the views were written against that shape and a thrown
 * network error unmounts a tree.
 *
 * `error` names the failures only the browser can see - the origin
 * never logs a connection that stalled in front of the edge - and the
 * client reports each as an analytics event so they are counted.
 */
export type TransportError = "timeout" | "network" | "bad_response";

export interface Envelope<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  error?: TransportError;
}

/** A failed envelope, as an Error, for callers that want to throw it:
 *  TanStack Query's error channel, mainly. `transport` says whether the
 *  request ever reached the API - the one distinction the retry policy
 *  needs. */
export class ApiError<T = unknown> extends Error {
  readonly status: number;
  readonly data: T;
  readonly transport: TransportError | null;

  constructor(envelope: Envelope<T>) {
    super(messageOf(envelope));
    this.name = "ApiError";
    this.status = envelope.status;
    this.data = envelope.data;
    this.transport = envelope.error ?? null;
  }
}

function messageOf(envelope: Envelope): string {
  const data = envelope.data as { message?: unknown; error?: unknown } | null;
  if (data && typeof data.message === "string") return data.message;
  if (data && typeof data.error === "string") return data.error;
  if (envelope.error) return envelope.error;
  return `HTTP ${envelope.status}`;
}

/** True when the request never got an answer from the API: no response,
 *  a 5xx, or a body the edge produced in front of it. These are the
 *  failures worth one quiet retry; a 4xx is an answer and is not. */
export function transportFailed(
  failure: Envelope | ApiError | unknown,
): boolean {
  if (failure instanceof ApiError)
    return failure.transport !== null || failure.status >= 500;
  if (failure && typeof failure === "object" && "ok" in failure) {
    const env = failure as Envelope;
    return !env.ok && (env.status === 0 || env.status >= 500 || !!env.error);
  }
  return false;
}

/** The envelope's data, or a thrown ApiError. For query functions. */
export function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.ok) throw new ApiError(envelope);
  return envelope.data;
}

/** A query function that resolves to the ENVELOPE when the API answered
 *  - a 401 is an answer, and the view reads the status - and rejects
 *  only when it did not, so the query client's retry applies to exactly
 *  the failures worth retrying. For views that branch on status; views
 *  that only want the payload use unwrap(). */
export function answered<T>(
  fn: () => Promise<Envelope<T>>,
): () => Promise<Envelope<T>> {
  return async () => {
    const envelope = await fn();
    if (transportFailed(envelope)) throw new ApiError(envelope);
    return envelope;
  };
}
