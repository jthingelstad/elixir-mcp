/**
 * Queue message contracts — the gateway <-> ingest seam (DESIGN §5.1).
 * Versioned like the tool contract: additive = fine, breaking = bump `v`.
 */

export interface CrJob {
  endpoint: string;
  /** Canonical entity key: a normalized tag, or 'GLOBAL'. */
  entity_key: string;
  lane: "live" | "bulk";
  /** Present on live-lane jobs so the MCP layer can await the receipt. */
  correlation_id?: string;
}

/** What a lease may ask the collector to drop before submitting
 *  (2026-09-11). Only on bulk-lane battlelog jobs whose observer has a
 *  high-water mark: `battles_after` is the newest battleTime the hub has
 *  already recorded, in the API's own battleTime format
 *  (`20260911T120000.000Z`) so the collector compares strings and never
 *  parses a date. A live-lane job never carries it: the agent waiting on
 *  a live read gets the whole log. A collector that ignores the filter
 *  is still correct, only wasteful. */
export interface LeaseFilter {
  battles_after?: string;
}

/** What /lease answers (2026-09-11: check-ins, not polling). A collector
 *  calls, gets a job or `empty`, and `next_check_in_s`: when to call
 *  again. 0 while work remains for it, the idle interval otherwise. The
 *  door no longer waits on a queue; a collector that ignores the field
 *  is still correct, only wasteful. */
export interface LeaseResponse {
  empty?: boolean;
  job?: CrJob;
  cr_path?: string;
  lease?: string;
  filter?: LeaseFilter;
  next_check_in_s: number;
}

/** ISO instant -> the API's battleTime spelling, for LeaseFilter. */
export function crBattleTime(iso: string): string {
  return iso
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
    .replace(/Z$/, ".000Z");
}

export interface CrResultMessage {
  v: 1;
  job: CrJob;
  /** Ledger job this result fulfils (0040/0041). Server-stamped by the
   *  collector door from the lease row; binds a live wait to ITS job so
   *  a bulk receipt for the same subject can never satisfy it. */
  job_id?: number;
  gateway_id: string;
  /** ISO 8601 UTC; stable across SQS redeliveries — the idempotency key
   *  component (unique with gateway_id + endpoint + entity_key). */
  fetched_at: string;
  status: "ok" | "error";
  http_status?: number;
  /** Response body, gzipped then base64 (SQS 256KB cap; DESIGN §5.1). */
  body_gzip_b64?: string;
  /** Collector-side filtering (2026-09-11). When the lease carried
   *  `filter.battles_after`, the collector dropped every battle at or
   *  before it and the body is the remainder - same shape as the API's
   *  array, fewer entries. `observed` is the count before the filter,
   *  `filtered` how many it dropped; new = observed - filtered. Absent
   *  from a collector that does not filter, and the hub treats the body
   *  as the whole log. `filtered: 0` with a mark is the capture-gap
   *  signal: nothing in the log was as old as what the hub had. */
  observed?: number;
  filtered?: number;
  /** Raw response bytes read from the CR API before any filter
   *  (2026-09-11, review §9.3): what the edge filter saved is the
   *  difference between this and the body it submitted. Optional. */
  api_bytes?: number;
  error?: {
    kind: "transport" | "http" | "overflow" | "breaker";
    message?: string;
  };
}

/** Email queue message — VPC Lambdas enqueue, the non-VPC relay sends
 *  (DESIGN §7 NAT-free posture). Plaintext email address rides the queue
 *  (SSE-encrypted at rest) because the relay must address the mail. */
/** The seven product mail kinds (docs/EMAIL.md): six weekly reports
 *  and the event-driven milestone mail. Every one is bulk: sent
 *  on a schedule to many people, switchable per kind on the account
 *  page, one-click unsubscribable. The body is RENDERED upstream (the
 *  jobs Lambda, packages/mail) and rides the message; the relay sends
 *  what it is given and never composes a report. */
export const PRODUCT_EMAIL_KINDS = [
  "clan_report",
  "arena_week",
  "tracking_report",
  "top_100",
  "card_of_week",
  "collector_activity",
  "milestone",
] as const;
export type ProductEmailKind = (typeof PRODUCT_EMAIL_KINDS)[number];

export interface EmailMessage {
  v: 1;
  kind: "login" | "welcome" | "owner_notify" | ProductEmailKind;
  to: string;
  /** product kinds: the rendered mail. subject and text are required;
   *  html rides beside them (multipart/alternative). */
  subject?: string;
  text?: string;
  html?: string;
  /** product kinds: the ledger row this send fulfils, for the log line. */
  issue_key?: string;
  /** product kinds: the send's own id (email_send.send_id, 0139), printed
   *  in the mail's footer and logged by the relay beside the transport's
   *  message id, so one sent email can be found from either end. */
  send_id?: string;
  /** login: the 6-digit code. */
  code?: string;
  /** login: the magic token for the link. */
  token?: string;
  /** login (oauth shell): client display name for the consent line. */
  client_name?: string;
  /** owner_notify: what happened. */
  note?: string;
  /** owner_notify: which event, so the relay can pick a subject. Absent on
   *  messages enqueued before 2026-09-09; the relay treats it as generic. */
  notify_kind?: OwnerNotifyKind;
  /** owner_notify: where to act on it (defaults to /admin). */
  link?: string;
  /** owner_notify: short labelled facts for the body (category, from...).
   *  Never an email address and never more than an excerpt of user text. */
  detail?: Record<string, string>;
  /** login: the account has affirmatively opted in to the newsletter, so
   *  this send is also its enrollment moment. Absent/false means send the
   *  mail and enroll nothing (issue #27) - authenticating is not consent
   *  to marketing, and the relay has no database to ask. */
  newsletter?: boolean;
  /** bulk kinds only: where one click unsubscribes this recipient. The
   *  relay turns it into List-Unsubscribe + List-Unsubscribe-Post (RFC
   *  8058). Refused on a transactional kind, required on a bulk one. */
  unsubscribe?: { url: string };
}

/**
 * Every kind is classified, and the classification is the mail policy
 * (2026-09-17, closing the List-Unsubscribe question):
 *
 * - transactional: a person asked for this exact message (a sign-in code)
 *   or it is the consequence of their own action or the operator's. It
 *   carries NO List-Unsubscribe: nobody can opt out of a code they just
 *   requested, Gmail's and Yahoo's bulk-sender rules exempt it, and the
 *   header on it would be a false signal. Its body says "if you did not
 *   request this, ignore it" instead.
 * - bulk: sent to many people on a schedule (a digest). MUST carry
 *   `unsubscribe.url`; the relay adds the one-click headers and the
 *   validator refuses the message without them.
 *
 * Adding a kind to EmailMessage["kind"] without a row here fails to
 * typecheck, so the decision is made where the kind is born.
 */
export const EMAIL_KIND_CLASS: Record<
  EmailMessage["kind"],
  "transactional" | "bulk"
> = {
  login: "transactional",
  welcome: "transactional",
  owner_notify: "transactional",
  clan_report: "bulk",
  arena_week: "bulk",
  tracking_report: "bulk",
  top_100: "bulk",
  card_of_week: "bulk",
  collector_activity: "bulk",
  milestone: "bulk",
};

export function isProductEmailKind(kind: unknown): kind is ProductEmailKind {
  return (PRODUCT_EMAIL_KINDS as readonly string[]).includes(kind as string);
}

/** The RFC 8058 headers for a validated message: two for a bulk kind,
 *  none for a transactional one. */
export function unsubscribeHeaders(
  msg: EmailMessage,
): { name: string; value: string }[] {
  if (EMAIL_KIND_CLASS[msg.kind] !== "bulk" || !msg.unsubscribe) return [];
  return [
    { name: "List-Unsubscribe", value: `<${msg.unsubscribe.url}>` },
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
  ];
}

export const OWNER_NOTIFY_KINDS = [
  "access_request",
  "feedback",
  "role_upgrade_request",
  "gateway_request",
  "gateway_quarantined",
  "approved_welcome",
] as const;
export type OwnerNotifyKind = (typeof OWNER_NOTIFY_KINDS)[number];

export function validateEmailMessage(
  msg: unknown,
): { ok: true; msg: EmailMessage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = msg as EmailMessage;
  if (typeof m !== "object" || m === null)
    return { ok: false, errors: [":not-an-object"] };
  if (m.v !== 1) errors.push("v:unsupported");
  const kindClass = EMAIL_KIND_CLASS[m.kind];
  if (!kindClass) errors.push("kind:invalid");
  if (typeof m.to !== "string" || !m.to.includes("@"))
    errors.push("to:invalid");
  // The mail policy, enforced where the mail is validated: a bulk kind
  // without a one-click unsubscribe never leaves; a transactional kind
  // carrying one is a mislabelled message, refused rather than sent with
  // a header that lies.
  const unsubUrl = m.unsubscribe?.url;
  if (kindClass === "bulk") {
    if (typeof unsubUrl !== "string" || !/^https:\/\//.test(unsubUrl))
      errors.push("unsubscribe:missing");
  } else if (kindClass && m.unsubscribe !== undefined) {
    errors.push("unsubscribe:transactional");
  }
  if (m.kind === "login" && typeof m.code !== "string")
    errors.push("code:missing");
  // A product kind arrives rendered: no subject or text means the
  // composer failed upstream, and a relay that filled one in would be
  // composing after all.
  if (isProductEmailKind(m.kind)) {
    if (typeof m.subject !== "string" || m.subject.length === 0)
      errors.push("subject:missing");
    if (typeof m.text !== "string" || m.text.length === 0)
      errors.push("text:missing");
    if (m.html !== undefined && typeof m.html !== "string")
      errors.push("html:invalid");
  }
  if (
    m.kind === "owner_notify" &&
    m.notify_kind !== undefined &&
    !(OWNER_NOTIFY_KINDS as readonly string[]).includes(m.notify_kind)
  )
    errors.push("notify_kind:invalid");
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}

/** Analytics event riding the SAME queue as email (the relay is the one
 *  non-VPC egress worker). Semantics differ deliberately: email retries
 *  hard and dead-letters; analytics is best-effort and DROPS on failure
 *  — a Tinylytics outage must never page anyone. Names are dotted
 *  category.action; values carry tool names and status classes, never
 *  user text (Thingy's rule). */
export interface AnalyticsEventMessage {
  v: 1;
  kind: "tinylytics_event";
  /** Dotted category.action, e.g. "mcp.tool_call". */
  event: string;
  value?: string;
}

export function isAnalyticsEventMessage(
  msg: unknown,
): msg is AnalyticsEventMessage {
  const m = msg as AnalyticsEventMessage;
  return (
    typeof m === "object" &&
    m !== null &&
    m.v === 1 &&
    m.kind === "tinylytics_event" &&
    typeof m.event === "string" &&
    m.event.includes(".") &&
    (m.value === undefined || typeof m.value === "string")
  );
}

const LANES = new Set(["live", "bulk"]);
const STATUSES = new Set(["ok", "error"]);

export function validateResultMessage(
  msg: unknown,
): { ok: true; msg: CrResultMessage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = msg as CrResultMessage;
  if (typeof m !== "object" || m === null)
    return { ok: false, errors: [":not-an-object"] };
  if (m.v !== 1) errors.push("v:unsupported");
  if (typeof m.job?.endpoint !== "string") errors.push("job.endpoint:missing");
  if (typeof m.job?.entity_key !== "string")
    errors.push("job.entity_key:missing");
  if (!LANES.has(m.job?.lane as string)) errors.push("job.lane:invalid");
  if (typeof m.gateway_id !== "string") errors.push("gateway_id:missing");
  if (
    typeof m.fetched_at !== "string" ||
    Number.isNaN(Date.parse(m.fetched_at))
  )
    errors.push("fetched_at:invalid");
  if (!STATUSES.has(m.status as string)) errors.push("status:invalid");
  if (m.status === "ok" && typeof m.body_gzip_b64 !== "string")
    errors.push("body_gzip_b64:missing");
  for (const k of ["observed", "filtered", "api_bytes"] as const) {
    const v = m[k];
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0))
      errors.push(`${k}:invalid`);
  }
  if (
    m.observed !== undefined &&
    m.filtered !== undefined &&
    m.filtered > m.observed
  )
    errors.push("filtered:exceeds-observed");
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}

/** The one job->CR-path mapping (zero-trust door: the SERVER computes
 *  the path and hands it to the collector, so collection changes never
 *  require a client update). Kept beside the queue contract because it
 *  IS part of the wire agreement with collectors. */
const CR_PATH_BY_ENDPOINT: Record<string, (key: string) => string> = {
  player: (key) => `/players/${encodeURIComponent(key)}`,
  player_battlelog: (key) => `/players/${encodeURIComponent(key)}/battlelog`,
  clan: (key) => `/clans/${encodeURIComponent(key)}`,
  currentriverrace: (key) =>
    `/clans/${encodeURIComponent(key)}/currentriverrace`,
  riverracelog: (key) => `/clans/${encodeURIComponent(key)}/riverracelog`,
  cards: () => `/cards`,
  // 1000, not 100 (0068). A ranking lists every player above the rating
  // floor — 847 globally on day 4 of S136 — and the top 100 of it is a
  // slice, not the board. The API returned all 847 at limit=1000 with no
  // cursor; if a board ever passes 1000 the snapshot records `truncated`
  // rather than pretending, and following the cursor is the next step.
  rankings_players: (key) =>
    `/locations/${encodeURIComponent(key)}/rankings/players?limit=1000`,
  rankings_pol: (key) =>
    `/locations/${encodeURIComponent(key)}/pathoflegend/players?limit=1000`,
  // A SEASON'S FINAL Path of Legends board (0069): the key is the API's
  // name for the season, the month it started in (2026-08). The API also
  // takes a bare number, but that is the position in its own seasons list
  // (143 = 2026-08), NOT the season number the game clock counts, which
  // is what 0069 mistook it for (0070). Served at full depth - 9,999
  // places, no cursor - for every season since 2022-10, and a different
  // view from the current-season board above, which lists only players
  // above the rating floor. No limit: the default is the whole board.
  rankings_pol_season: (key) =>
    `/locations/global/pathoflegend/${encodeURIComponent(key)}/rankings/players`,
  // The clan ladders by location (0069).
  rankings_clans_loc: (key) =>
    `/locations/${encodeURIComponent(key)}/rankings/clans?limit=1000`,
  rankings_clanwars: (key) =>
    `/locations/${encodeURIComponent(key)}/rankings/clanwars?limit=1000`,
  // The game-mode boards (0069): the list, then each board by its id.
  leaderboards: () => `/leaderboards`,
  leaderboard: (key) => `/leaderboard/${encodeURIComponent(key)}?limit=1000`,
  // What is on (0069): the events and tournaments running right now,
  // which the API forgets the moment they end.
  events: () => `/events`,
  globaltournaments: () => `/globaltournaments`,
};

export function crPathForJob(job: {
  endpoint: string;
  entity_key: string;
}): string | null {
  const build = CR_PATH_BY_ENDPOINT[job.endpoint];
  return build ? build(job.entity_key) : null;
}
