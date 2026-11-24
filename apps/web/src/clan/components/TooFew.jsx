/**
 * Below the smallest clan a policy engages with (10 members, as Clan Wars):
 * Clan is a statistics view there, and every clan-management and
 * awards page says so in the same words.
 */
import { Empty } from "@elixir-mcp/ui";
export function TooFew({ members, min = 10 }) {
  return (
    <Empty title={<>Clan management starts at {min} members</>}>
      {members != null
        ? `This clan has ${members}. `
        : "This clan is below that for now. "}
      Like Clan Wars, the rules, actions, standing and awards start at {min}.
      Until then you get the roster and everyone&rsquo;s numbers, and elders and
      up can use Recruit and Scout. Saved rules are kept until then.
    </Empty>
  );
}
