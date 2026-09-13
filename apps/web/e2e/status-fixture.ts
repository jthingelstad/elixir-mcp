/** The public status payload: the status test's fixture, verbatim. */
export const STATUS = {
  as_of: "2026-09-06T15:00:00.000Z",
  health: {
    ok: true,
    last_fetch_seconds: 12,
    last_admission_seconds: 30,
    dlq_messages: 0,
    battles_last_hour: 5861,
    capture_audit_24h: { polls: 50, gaps: 0 },
  },
  jobs: null,
  queue: {
    due_now: 9,
    due_starved: 1,
    due_by_endpoint: { player_battlelog: 6, clan: 3 },
    queued: 2,
    leased: 1,
    done_hour: 80,
    last_tick_at: "2026-09-06T14:57:36.000Z",
    next_tick_at: "2026-09-06T15:02:36.000Z",
    tick_minutes: 5,
    next_tick_capacity: 270,
  },
  collectors: [
    {
      name: "Ram Rider",
      card_icon: null,
      status: "active",
      // Heartbeating seconds ago, but no ADMITTED payload for 20 minutes:
      // idle, not broken, and the page has to be able to say so.
      last_heartbeat_at: "2026-09-06T14:59:57.000Z",
      last_success_at: "2026-09-06T14:40:00.000Z",
      operator: "Thingelstad",
      operator_tag: "#20JJJ2CCRU",
      fetches_1h: 161,
    },
    {
      name: "Wall Breakers",
      card_icon: null,
      status: "active",
      last_heartbeat_at: "2026-09-06T14:59:55.000Z",
      last_success_at: "2026-09-06T14:59:00.000Z",
      // No owner, or an owner who claimed no player: no credit to give.
      operator: null,
      operator_tag: null,
      fetches_1h: 137,
    },
  ],
  capture_series: ["Ram Rider", "Wall Breakers"],
  capture_5m: [
    { bucket: "14:50", fetches: 0, admitted: 0, rejected: 0, by: {} },
    {
      bucket: "14:55",
      fetches: 30,
      admitted: 28,
      rejected: 2,
      by: { "Ram Rider": 18, "Wall Breakers": 12 },
    },
    // The bucket in progress: the server gap-fills up to now.
    { bucket: "15:00", fetches: 0, admitted: 0, rejected: 0, by: {} },
  ],
  capture_24h: [
    {
      bucket: "13:00",
      fetches: 210,
      admitted: 210,
      rejected: 0,
      by: { "Ram Rider": 130, "Wall Breakers": 80 },
    },
    { bucket: "14:00", fetches: 0, admitted: 0, rejected: 0, by: {} },
  ],
};
