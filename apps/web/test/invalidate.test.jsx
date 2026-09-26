import { test, expect } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { act, fireEvent, screen } from "@testing-library/react";
import { useInvalidate } from "../src/lib/queries.js";
import { renderWithProviders } from "./helpers.jsx";

// A write that lands while the page's first read is still in flight:
// the read answered from before the write, so the refetch after it must
// be a new request, not the pending one (TanStack joins a pending fetch
// on a query with no data yet).
test("invalidate after a write refetches even when the first read is still in flight", async () => {
  const rows = [];
  const pending = [];
  const fetchRows = () =>
    new Promise((resolve) => {
      const snapshot = [...rows];
      pending.push(() => resolve(snapshot));
    });
  const invalidations = [];
  function List() {
    const invalidate = useInvalidate();
    const q = useQuery({ queryKey: ["me", "rows"], queryFn: fetchRows });
    return (
      <>
        <p>{q.data ? `rows: ${q.data.join(",") || "none"}` : "loading"}</p>
        <button onClick={() => invalidations.push(invalidate(["me", "rows"]))}>
          Saved
        </button>
      </>
    );
  }
  renderWithProviders(<List />);
  expect(pending).toHaveLength(1);

  rows.push("ui-platform");
  await act(async () => fireEvent.click(screen.getByText("Saved")));
  // The first read resolves late with what it saw before the write.
  await act(async () => pending[0]());
  expect(pending).toHaveLength(2);
  await act(async () => {
    pending[1]();
    await invalidations[0];
  });
  expect(await screen.findByText("rows: ui-platform")).toBeTruthy();
});
