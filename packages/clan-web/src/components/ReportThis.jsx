import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import { FeedbackSheet, Icon } from "@elixir-mcp/ui";
import { useState } from "react";
import { feedbackApi } from "../api.js";

/** Where a filed item is read: the person's own feedback in the Console,
 *  where its answer lands too. */
export const feedbackItemHref = (id) => `/console/account/feedback/${id}`;

/**
 * "Report this", beside a judgment Elixir Clan made: an action, a
 * standing, an award race (2026-10-08). It files into Elixir's one
 * feedback record, area clan, pointing at the thing on screen, so the
 * maintainer reads the action or the policy the person was looking at
 * rather than a description of it. Judgment is the category it opens on;
 * the person can pick another.
 */
export function ReportThis({
  about,
  refs,
  context,
  label = "Report this",
  category = "judgment",
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen(true)}
        title="Tell the maintainer this looks wrong"
      >
        <Icon name="flag" size={14} />
        {label}
      </button>
      {open && (
        <FeedbackSheet
          area="clan"
          title={label}
          categories={FEEDBACK_CATEGORIES}
          category={category}
          about={about}
          refs={refs}
          context={context}
          placeholder="What looks wrong, and what you expected instead. Markdown is fine."
          send={feedbackApi.send}
          onClose={() => setOpen(false)}
          itemHref={feedbackItemHref}
        />
      )}
    </>
  );
}
