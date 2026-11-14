/** Invented people used by Find journeys and visual captures. */
export const HOSTILE = "<img src=x onerror=alert(1)>Fern";
const battles = (o: Record<string, number>) => [
  {
    kind: "battles",
    against: 0,
    with_you: 0,
    friendly: 0,
    clanmate_battles: 0,
    days: 30,
    ...o,
  },
];
const CLANMATES = [
  "#02G2PJC0",
  "#08VP8VYY",
  "#0J9YCYL2",
  "#09VURCVC",
  "#0VJLCPJ0",
  "#00JRG2RU",
  "#0LJR0G22",
  "#0U082URG",
  "#00092VJ2",
];
const PEOPLE = [
  {
    tag: "#0YP8U0Y0",
    name: HOSTILE,
    why: battles({ against: 1, friendly: 1 }),
    free: false,
    reason: null,
  },
  {
    tag: "#0G2ULUJP",
    name: "Juniper",
    why: [
      {
        kind: "followed_by",
        via: { tag: "#0Q2UQ2YR", name: "Ada" },
        others: 0,
      },
    ],
    free: false,
    reason: null,
  },
  {
    tag: "#080J2V9Q",
    name: "Elm",
    why: battles({ with_you: 2 }),
    free: true,
    reason: "recorded",
  },
  ...CLANMATES.map((tag, i) => ({
    tag,
    name: `Invented Clanmate ${i + 1}`,
    why: [{ kind: "clan", clan_name: "Grove" }],
    free: false,
    reason: null,
  })),
];
export const FIND = {
  ok: true,
  days: 30,
  people: PEOPLE,
  more: 4,
  used: 3,
  limit: 50,
};
