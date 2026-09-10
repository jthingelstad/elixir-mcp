/**
 * The call record: one tool call's request, response and timings
 * (review 2026-09-10, Part 5). The page renders what the API handed it,
 * folds the response's meta envelope, cuts arrays past twenty rows
 * behind "show all", and links the previous and next call by the same
 * connection and the feedback form prefilled with the request id.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { CallRecord } from "../src/views/account/CallRecord.jsx";
import { Activity } from "../src/views/Activity.jsx";
import { railPosition, DOC_LINKS } from "../src/App.jsx";

const ID = "11111111-1111-4111-8111-111111111111";
const PREV = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";

const RECORD = {
  call: {
    request_id: ID,
    tool: "war_history",
    surface: "mcp",
    token_name: "elixir-mcp-discord",
    client_name: "discord-bot",
    viewer_country: "US",
    created_at: "2026-09-10T14:02:11.000Z",
    duration_ms: 1240,
    db_ms: 810,
    db_queries: 9,
    live_wait_ms: null,
    serialize_ms: 12,
    result_bytes: 38000,
    truncated: false,
    error_code: null,
    rpc_error_code: null,
    cold_start: true,
    principal_kind: "agent",
    on_behalf_of: "discord:42",
    captured: true,
    args: { clan_tag: "#ABC", weeks: 30 },
  },
  prev: {
    request_id: PREV,
    tool: "war_current",
    created_at: "2026-09-10T14:01:00Z",
  },
  next: {
    request_id: NEXT,
    tool: "clans_roster",
    created_at: "2026-09-10T14:03:00Z",
  },
  request: { tool: "war_history", arguments: { clan_tag: "#ABC", weeks: 30 } },
  response: {
    weeks: Array.from({ length: 30 }, (_, i) => ({
      week: i + 1,
      fame: 1000 * i,
    })),
    meta: {
      request_id: ID,
      as_of: "2026-09-10T14:02:11Z",
      contract_version: "1.0.0",
      quota: { count: 41, max: 500 },
    },
  },
  timings: { db_ms: 810 },
  captured_at: "2026-09-10T14:02:12.000Z",
};

function stub(body = RECORD, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

beforeEach(() => cleanup());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("the record: tool, metrics strip, folded meta, cut arrays, neighbours, feedback prefill", async () => {
  stub();
  const navigate = vi.fn();
  render(<CallRecord id={ID} navigate={navigate} />);
  await waitFor(() => screen.getByRole("heading", { name: "war_history" }));
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/me/activity/calls/${ID}`,
    expect.anything(),
  );

  // The metrics strip reads from the row.
  expect(screen.getByText("1,240 ms")).toBeTruthy();
  expect(screen.getByText("810 ms")).toBeTruthy();
  expect(screen.getByText("9 queries")).toBeTruthy();
  expect(screen.getByText("no live fetch")).toBeTruthy();
  expect(screen.getByText("37.1 KB")).toBeTruthy();
  expect(screen.getByText("41 / 500")).toBeTruthy();
  expect(screen.getByText("discord-bot")).toBeTruthy();
  expect(screen.getByText("US")).toBeTruthy();
  expect(screen.getByText(/on behalf of discord:42/)).toBeTruthy();

  // The JSON is rendered as text nodes inside <pre>, so read it whole.
  const rendered = () => document.body.textContent;
  expect(rendered()).toContain('"clan_tag": "#ABC"');

  // meta is folded until asked for; arrays past 20 are cut.
  const foldMeta = screen.getByRole("button", { name: /4 fields/ });
  expect(rendered()).not.toContain('"contract_version"');
  fireEvent.click(foldMeta);
  expect(rendered()).toContain('"contract_version": "1.0.0"');

  const showAll = screen.getByRole("button", { name: "show all 30" });
  expect(rendered()).toContain('"week": 20');
  expect(rendered()).not.toContain('"week": 21');
  fireEvent.click(showAll);
  expect(rendered()).toContain('"week": 30');
  expect(screen.queryByRole("button", { name: "show all 30" })).toBeNull();

  // Previous and next by the same connection.
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous call" }));
  expect(navigate).toHaveBeenCalledWith(`/account/activity/c/${PREV}`);
  fireEvent.click(screen.getByRole("button", { name: "Next call ›" }));
  expect(navigate).toHaveBeenCalledWith(`/account/activity/c/${NEXT}`);

  // Feedback, prefilled with the id the docs tell people to quote.
  fireEvent.click(screen.getByText("Report this call"));
  expect(navigate).toHaveBeenCalledWith(
    `/account/feedback?context=${encodeURIComponent(`request_id:${ID}`)}`,
  );
  expect(screen.getByText(/kept 90 days/)).toBeTruthy();
});

test("a row without a captured body still renders from the log's bounded arguments", async () => {
  stub({
    ...RECORD,
    call: {
      ...RECORD.call,
      captured: false,
      rpc_error_code: -32029,
      tool: "elixir_events",
    },
    request: null,
    response: null,
    timings: null,
    captured_at: null,
    prev: null,
    next: null,
  });
  render(<CallRecord id={ID} navigate={() => {}} />);
  await waitFor(() => screen.getByRole("heading", { name: "elixir_events" }));
  expect(screen.getByText(/refused · daily quota/)).toBeTruthy();
  expect(screen.getByText("Not captured for this call.")).toBeTruthy();
  expect(screen.getByText(/Refused before any tool ran/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "‹ Previous call" }).disabled).toBe(
    true,
  );
});

test("an id that is not in the reader's log says so, with the way back", async () => {
  stub({ error: "not_found" }, 404);
  render(<CallRecord id={ID} navigate={() => {}} />);
  await waitFor(() => screen.getByText("That call is not in your log"));
  expect(screen.getByText("‹ MCP requests")).toBeTruthy();
});

test("the Activity log links each request id to its record", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const data = {
        requests: [
          {
            tool: "war_current",
            surface: "mcp",
            duration_ms: 90,
            created_at: "2026-09-10T14:02:11Z",
            request_id: ID,
          },
        ],
      };
      return {
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      };
    }),
  );
  const navigate = vi.fn();
  render(<Activity sub="requests" navigate={navigate} />);
  await waitFor(() => screen.getByText(ID.slice(0, 8)));
  fireEvent.click(screen.getByText(ID.slice(0, 8)));
  expect(navigate).toHaveBeenCalledWith(`/account/activity/c/${ID}`);
});

test("the record belongs to MCP requests in the rail and has its own docs strip", () => {
  const at = railPosition(`/account/activity/c/${ID}`);
  expect(at).toEqual({
    key: "activity",
    sub: "requests",
    doc: "activity:call",
  });
  expect(DOC_LINKS["activity:call"]).toBeTruthy();
});
