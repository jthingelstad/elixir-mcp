import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "../client/index.ts";
import { api } from "../api.js";
import {
  onboardingPeopleKey,
  useOnboardingPeopleRead,
} from "../lib/queries.js";

/** Only a first-day claim needs this extra progress read. Its own server
 * timestamps decide the opportunity; the client never grants permission.
 */
export function useOnboardingPeople(first) {
  const player = first?.player;
  const age =
    Date.parse(first?.as_of ?? "") - Date.parse(player?.tracked_since ?? "");
  const progress = useOnboardingPeopleRead(
    Boolean(player) && age >= 0 && age < 24 * 60 * 60_000,
  );
  const client = useQueryClient();
  const requested = useRef(null);
  const readAt = useRef(null);
  const request = useMutation({
    mutationFn: () => api.requestOnboardingPeople().then(unwrap),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: onboardingPeopleKey }),
  });
  const { mutate } = request;
  const data = progress.data;
  useEffect(() => {
    if (!data?.may_request || requested.current === data.player_tag) return;
    requested.current = data.player_tag;
    mutate();
  }, [data?.may_request, data?.player_tag, mutate]);
  useEffect(() => {
    if (!data?.read_at || readAt.current === data.read_at) return;
    readAt.current = data.read_at;
    client.invalidateQueries({ queryKey: ["me", "people"] });
  }, [client, data?.read_at]);
  return {
    ...progress,
    request,
    retry: async () => {
      request.reset();
      const fresh = await progress.refetch();
      if (fresh.data?.may_request) {
        requested.current = fresh.data.player_tag;
        mutate();
      }
    },
  };
}
