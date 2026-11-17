export const AUTHOR_TAG = "#0PGQ2UYL";
export const READER_TAG = "#0RJ29CVY";
export const STRANGER_TAG = "#0LYQ8GRP";

/** Synthetic people and posts shared by the two delivery-door regressions. */
export async function postFixture(db, prefix) {
  const accounts = {};
  for (const who of ["author", "reader", "fan", "stranger"])
    accounts[who] = (
      await db.query(
        `insert into account (email_hash, email, status, timezone)
       values ($1, $2, 'approved', 'UTC') returning account_id`,
        [`${prefix}-${who}`, `${who}@example.test`],
      )
    ).rows[0].account_id;
  for (const [tag, name] of [
    [AUTHOR_TAG, "<b>Writer</b> & Friend"],
    [READER_TAG, "Reader"],
    [STRANGER_TAG, "Stranger"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  for (const [who, tag] of [
    ["author", AUTHOR_TAG],
    ["reader", READER_TAG],
    ["stranger", STRANGER_TAG],
  ])
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship, notify, verified_at)
                    values ($1, $2, 'verified', true, 'primary', true, now())`,
      [accounts[who], tag],
    );
  await db.query(
    `insert into claim (account_id, player_tag, status, relationship, notify)
                  values ($1, $2, 'unverified', 'friend', true)`,
    [accounts.reader, AUTHOR_TAG],
  );
  await db.query(
    `insert into account_follow (account_id, followed_account_id) values ($1, $2)`,
    [accounts.fan, accounts.author],
  );
  let serial = 0;
  return {
    ...accounts,
    async post({
      text = "Which card would you swap?",
      at = new Date(),
      question = true,
      cards = [],
      deck = null,
      who = "author",
    } = {}) {
      const itemId = `tl_${String(++serial).padStart(20, "0")}`;
      const { rows } = await db.query(
        `insert into account_post (item_id, account_id, player_tag, body, question, cards, deck, created_at)
         values ($1, $2, $3, $4, $5, $6::int[], $7::jsonb, $8)
         returning post_id::text as id, item_id, created_at`,
        [
          itemId,
          accounts[who],
          who === "stranger" ? STRANGER_TAG : AUTHOR_TAG,
          text,
          question,
          cards,
          deck ? JSON.stringify(deck) : null,
          at,
        ],
      );
      return rows[0];
    },
  };
}
