/** The feedback-answer fixture (#536 stage 2): one person with two
 *  settled, unread answers, each written as answerFeedback writes it (the
 *  feedback row and its account_event in one instant). The first event
 *  carries the answer's words, as answers do from 11.13.0; the second is
 *  an event from before it (feedback_id and status only), whose words
 *  are the row's. Its message runs past the 600 characters a mail
 *  prints. */
export const FEEDBACK = { done: "9001", question: "9002" };
export const ANSWERED = {
  done: "2026-10-07T16:30:00.123456Z",
  question: "2026-10-07T16:31:00.654321Z",
};
const LONG_MESSAGE =
  `The rank looked off on Ladder. ${"It said Master 2 while the game said Master 3. ".repeat(14)}`.trim();

export async function feedbackFixture(db) {
  const accountId = (
    await db.query(
      `insert into account (email_hash, email, status, timezone)
       values ('h-answer', 'answer@example.com', 'approved', 'America/Chicago')
       returning account_id`,
    )
  ).rows[0].account_id;
  const answer = async (
    id,
    { area, category, status, message, filed, response, shipped, at, words },
  ) => {
    await db.query(
      `insert into feedback (feedback_id, account_id, surface, area, category, message,
                             status, response, responded_at, shipped_in, created_at)
       overriding system value
       values ($1, $2, 'web', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        accountId,
        area,
        category,
        message,
        status,
        response,
        at,
        shipped,
        filed,
      ],
    );
    await db.query(
      `insert into account_event (account_id, kind, detail, created_at)
       values ($1, 'feedback_responded', $2, $3)`,
      [
        accountId,
        JSON.stringify({
          feedback_id: Number(id),
          status,
          ...(words ? { response, shipped_in: shipped } : {}),
        }),
        at,
      ],
    );
  };
  await answer(FEEDBACK.done, {
    area: "ladder",
    category: "bug",
    status: "done",
    message: LONG_MESSAGE,
    filed: "2026-10-06T21:15:00Z",
    response:
      "Fixed: Ladder reads the live board now.\n\nThanks for the report.",
    shipped: "11.10.1",
    at: ANSWERED.done,
    words: true,
  });
  await answer(FEEDBACK.question, {
    area: "mcp",
    category: "general",
    status: "needs_info",
    message: "Could elixir_timeline say which deck won?",
    filed: "2026-10-07T09:00:00Z",
    response: "Which deck do you mean: yours or the opponent's?",
    shipped: null,
    at: ANSWERED.question,
    words: false,
  });
  return { accountId };
}
