import { PageHead } from "../components/PageHead.jsx";
import { ActivityDiscordSetting } from "./ActivityDiscordSetting.jsx";

/**
 * Social ▸ Discord (Jamie, 2026-10-10): the clan's activity in a Discord
 * channel of its own, a page in the rail's Social group for the leader
 * and co-leaders, beside the map and Recruit. Not a Settings section:
 * Settings keeps the Actions webhook and the clan's own model, which the
 * editor here points to.
 */
export function ActivityDiscord({ clan, navigate }) {
  return (
    <div className="grid gap-5">
      <PageHead
        clan={clan}
        crumb="Discord"
        title="Discord"
        lede="The clan’s activity, posted as short stories."
        navigate={navigate}
      />
      <ActivityDiscordSetting clan={clan} navigate={navigate} />
    </div>
  );
}
