import { checkRateLimit } from "@elixir-mcp/auth";
import { json } from "../http.mjs";
import {
  onboardingPeople,
  requestOnboardingPeople,
} from "../onboarding-people.mjs";

export function onboardingPeopleRoutes({ resolveAccount, live }) {
  const route = (request) => async (db, event) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: request,
    });
    if (!account) return json(401, { error: "unauthenticated" });
    if (account.kind !== "person") return json(403, { error: "not_entitled" });
    if (
      !(await checkRateLimit(db, {
        bucket: `onboarding#${account.accountId}`,
        max: 900,
      }))
    )
      return json(429, { error: "rate_limited" });
    return json(
      200,
      request
        ? await requestOnboardingPeople(db, account.accountId, live)
        : await onboardingPeople(db, account.accountId),
    );
  };
  return {
    "GET /api/me/people/onboarding": route(false),
    "POST /api/me/people/onboarding": route(true),
  };
}
