/** The milestone fixture the digest tests share: a primary and an alt
 *  with moments of every rank, one the account was already told of, and
 *  the small things milestone never mails. */
export const PRIMARY = "#2QYQ9V0P";
export const ALT = "#8LQ2PJ0C";
export const OPPONENT = "#2PGQ8Y0L";
export const WINDOW = {
  fromMs: Date.parse("2026-10-07T00:00:00Z"),
  toMs: Date.parse("2026-10-08T00:00:00Z"),
};

export async function milestoneFixture(db) {
  const accountId = (
    await db.query(
      `insert into account (email_hash, email, status, timezone)
       values ('h-digest', 'digest@example.com', 'approved', 'America/Chicago')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into player (player_tag, name) values
       ($1, 'Primary One'), ($2, 'Alt Two'), ($3, 'SparkSanji')`,
    [PRIMARY, ALT, OPPONENT],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true),
            ($1, $3, 'verified', false, 'alt', true)`,
    [accountId, PRIMARY, ALT],
  );
  await db.query(
    `insert into card (card_id, name, kind, rarity) values
       (26000021, 'Hog Rider', 'card', 'rare')
     on conflict (card_id) do nothing`,
  );
  const BATTLE = `d16e57${"0".repeat(58)}`;
  const at = "2026-10-07T17:00:00Z";
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'PvP', 'pvp')`,
    [BATTLE, at],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, battle_time, outcome, type, type_class,
        crowns, trophy_change, starting_trophies)
     values ($1, $2, 0, $4, 'win', 'PvP', 'pvp', 2, 30, 4980),
            ($1, $3, 1, $4, 'loss', 'PvP', 'pvp', 1, -30, 5012)`,
    [BATTLE, PRIMARY, OPPONENT, at],
  );
  const moment = (tag, type, from, to, cols = {}) => {
    const names = Object.keys(cols);
    return db.query(
      `insert into player_event
         (player_tag, event_type, timing, window_start, window_end${names.map((n) => `, ${n}`).join("")})
       values ($1, $2, 'estimated', $3, $4${names.map((_, i) => `, $${i + 5}`).join("")})`,
      [tag, type, from, to, ...Object.values(cols)],
    );
  };
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end,
        arena_from, arena_to, arena_to_name, battle_id)
     values ($1, 'arena_changed', 'exact', $2, $2, 14, 15, 'Electro Valley', $3)`,
    [PRIMARY, at, BATTLE],
  );
  await moment(
    PRIMARY,
    "ranked_promotion",
    "2026-10-07T18:00:00Z",
    "2026-10-07T18:30:00Z",
    {
      league_from: 3,
      league_to: 4,
    },
  );
  await moment(
    PRIMARY,
    "legendary_badge_earned",
    "2026-10-07T09:00:00Z",
    "2026-10-07T09:10:00Z",
    {
      badge_name: "BeatingDeathBadge",
    },
  );
  await moment(
    PRIMARY,
    "card_form_unlocked",
    "2026-10-07T11:00:00Z",
    "2026-10-07T12:00:00Z",
    {
      card_id: 26000021,
      step: 1,
    },
  );
  await moment(
    PRIMARY,
    "career_wins_step",
    "2026-10-07T13:00:00Z",
    "2026-10-07T14:00:00Z",
    {
      value_after: 3000,
      step: 3000,
    },
  );
  // Small things: counted on Tuesday, never mailed.
  await moment(
    PRIMARY,
    "badge_earned",
    "2026-10-07T10:00:00Z",
    "2026-10-07T10:30:00Z",
    {
      badge_name: "MasteryArrows",
      level: 5,
    },
  );
  await moment(
    ALT,
    "career_wins_step",
    "2026-10-07T15:00:00Z",
    "2026-10-07T16:00:00Z",
    {
      value_after: 1000,
      step: 1000,
    },
  );
  await moment(
    ALT,
    "career_wins_step",
    "2026-10-07T06:00:00Z",
    "2026-10-07T07:00:00Z",
    {
      value_after: 2000,
      step: 2000,
    },
  );
  // Told before: the alt's 2,000 wins mailed already.
  await db.query(
    `insert into email_milestone (account_id, subject_tag, kind, moment_key)
     values ($1, $2, 'career_wins_step', 'wins:2000')`,
    [accountId, ALT],
  );
  return { accountId, timezone: "America/Chicago" };
}

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
export const LONG_MESSAGE =
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
