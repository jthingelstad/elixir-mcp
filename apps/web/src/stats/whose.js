import { createContext, useContext } from "react";

/**
 * Whose season Stats is reading (2026-11-12): your own player's, or one you
 * follow ("Stats opens for the players you follow"). The words that name
 * the reader come from here, so a followed player's page says "their" where
 * your own says "your". Facts only either way: the numbers are the same reads.
 */
const OWN = {
  own: true,
  your: "your",
  Your: "Your",
  you: "you",
  You: "You",
  them: "you",
  yours: "yours",
};
const FOLLOWED = {
  own: false,
  your: "their",
  Your: "Their",
  you: "they",
  You: "They",
  them: "them",
  yours: "theirs",
};

export const Whose = createContext(OWN);

/** The words for this page's player: OWN unless a followed player is open. */
export function whoseWords(own) {
  return own ? OWN : FOLLOWED;
}

export function useWhose() {
  return useContext(Whose);
}
