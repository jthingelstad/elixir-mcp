/** Explicit proof states for invented people; card choice is independent. */
export const PLAYER_VERIFICATIONS = {
  "#20JJJ2CCRU": true,
  "#00C298UC": true,
  "#0G2ULUJP": true,
  "#080J2V9Q": false,
  "#0J0RVYRR": true,
  "#0JVRYLGG": false,
  "#098R2R0PUL": true,
  "#000QY0L0C": true,
  "#02QQPCYQQ": false,
};
export function identityFixtures(routes: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(routes).map(([key, answer]) => {
      if (
        !Array.isArray(answer) ||
        answer[0] !== 200 ||
        !answer[1] ||
        typeof answer[1] !== "object"
      )
        return [key, answer];
      return [
        key,
        [
          answer[0],
          { ...answer[1], player_verifications: PLAYER_VERIFICATIONS },
        ],
      ];
    }),
  );
}
