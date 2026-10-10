import { PageHead } from "../components/PageHead.jsx";
import { ActivityDiscordSetting } from "./ActivityDiscordSetting.jsx";

/**
 * Social ▸ Discord (Jamie, 2026-10-10): the clan's activity in a Discord
 * channel of its own, a page in the rail's Social group for the leader
 * and co-leaders, beside the map and Recruit. Not a Settings section:
 * Settings keeps the Actions webhook and the clan's own model, which the
 * rewrite here points to.
 */
export function ActivityDiscord({ clan, navigate }) {
  return (
    <div className="grid max-w-[720px] gap-6">
      <PageHead
        clan={clan}
        crumb="Discord"
        title="Discord"
        lede="Post the clan's activity to a Discord channel as it happens: who joins and departs, members' milestones and the Clan Wars week."
        navigate={navigate}
      />
      <ActivityDiscordSetting clan={clan} navigate={navigate} />
    </div>
  );
}
