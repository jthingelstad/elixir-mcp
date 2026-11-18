export const isDigestPost = (item) =>
  item.kind === "post" || item.kind === "battle_highlight";

export const digestPostCount = (person) =>
  person.post_count ?? (person.items ?? []).filter(isDigestPost).length;

/** Each row is one followed player. Someone who posted and played belongs
 *  in both counts. The builder calls this before it limits the email to
 *  twelve people. Offline previews can use the same rule on their rows. */
export function digestActivity(people) {
  const activity = { posters: 0, posts: 0, players: 0, battles: 0 };
  for (const person of people) {
    const posts = digestPostCount(person);
    if (posts > 0) {
      activity.posters++;
      activity.posts += posts;
    }
    if (person.battles > 0) {
      activity.players++;
      activity.battles += person.battles;
    }
  }
  return activity;
}
