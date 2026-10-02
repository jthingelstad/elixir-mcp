/** Battle pages as /api/public/battles/<ref> serves them: projections
 *  of the repo's own battle-log fixture (player_battlelog/
 *  with_colosseum_duel.json), read through services/web-api's
 *  readPublicBattle - a Trophy Road 1v1 and a Colosseum duel. */
export const BATTLE = {
  battle: {
    id: "ccd04012bda83b5715777045eb019ca3a1dc7c60907a445508dd8e787dd58805",
    short_id: "ccd04012bda8",
    url: "https://elixir.poapkings.com/battle/ccd04012bda8",
    image: "https://elixir.poapkings.com/battle/ccd04012bda8.png",
    battle_time: "2026-09-03T14:11:39.000Z",
    type: "PvP",
    kind: "1v1",
    mode_group: "ladder",
    game_mode: {
      id: 72000006,
      name: "Ladder",
    },
    arena: {
      id: 54000144,
      name: "Spirit Square",
    },
    duration: {
      at_least_s: 180,
      at_most_s: 300,
      exact_s: null,
      basis: "regulation_ran",
    },
    deck_level_edge: 0.12,
  },
  sides: [
    {
      outcome: "win",
      crowns: 2,
      tower_hp: {
        king: 7728,
        princess: [3107, 0],
      },
      players: [
        {
          player_tag: "#JYRQ8U92C",
          name: "sikander sidhu",
          clan_tag: "#J2RGCRVG",
          clan_name: null,
          starting_trophies: 13591,
          trophy_change: 30,
          global_rank: null,
          elixir_leaked: 1.41,
          deck: {
            cards: [
              {
                id: 26000055,
                name: "Mega Knight",
                form: "evolution",
                level: 16,
              },
              {
                id: 26000074,
                name: "Golden Knight",
                form: "base",
                level: 16,
              },
              {
                id: 26000007,
                name: "Witch",
                form: "evolution",
                level: 16,
              },
              {
                id: 26000011,
                name: "Valkyrie",
                form: "base",
                level: 16,
              },
              {
                id: 26000064,
                name: "Firecracker",
                form: "base",
                level: 16,
              },
              {
                id: 28000006,
                name: "Mirror",
                form: "base",
                level: 16,
              },
              {
                id: 26000021,
                name: "Hog Rider",
                form: "base",
                level: 16,
              },
              {
                id: 28000001,
                name: "Arrows",
                form: "base",
                level: 16,
              },
            ],
            tower_troop: {
              id: 159000000,
              name: "Tower Princess",
              level: 16,
            },
            label: "Beatdown",
            average_elixir: 4.29,
            cycle4: null,
            average_level: 16,
          },
          rounds: null,
        },
      ],
    },
    {
      outcome: "loss",
      crowns: 1,
      tower_hp: {
        king: 7524,
        princess: [0, 0],
      },
      players: [
        {
          player_tag: "#20GVLYJV9P",
          name: "Silent_Hobbit",
          clan_tag: null,
          clan_name: null,
          starting_trophies: 13591,
          trophy_change: -30,
          global_rank: null,
          elixir_leaked: 0.06,
          deck: {
            cards: [
              {
                id: 26000007,
                name: "Witch",
                form: "evolution",
                level: 15,
              },
              {
                id: 26000065,
                name: "Mighty Miner",
                form: "base",
                level: 16,
              },
              {
                id: 27000010,
                name: "Furnace",
                form: "evolution",
                level: 16,
              },
              {
                id: 26000022,
                name: "Minion Horde",
                form: "base",
                level: 16,
              },
              {
                id: 26000042,
                name: "Electro Wizard",
                form: "base",
                level: 16,
              },
              {
                id: 28000023,
                name: "Void",
                form: "base",
                level: 16,
              },
              {
                id: 26000043,
                name: "Elite Barbarians",
                form: "base",
                level: 16,
              },
              {
                id: 26000083,
                name: "Mother Witch",
                form: "base",
                level: 16,
              },
            ],
            tower_troop: {
              id: 159000004,
              name: "Royal Chef",
              level: 16,
            },
            label: "Beatdown",
            average_elixir: 4.63,
            cycle4: 16,
            average_level: 15.88,
          },
          rounds: null,
        },
      ],
    },
  ],
  games: null,
  meetings: [
    {
      url: "https://elixir.poapkings.com/battle/ccd04012bda8",
      battle_time: "2026-09-03T14:11:39.000Z",
      mode_group: "ladder",
      duel: false,
      crowns: 2,
      crowns_against: 1,
      outcome: "win",
    },
  ],
  sitting: [
    {
      url: "https://elixir.poapkings.com/battle/ccd04012bda8",
      battle_time: "2026-09-03T14:11:39.000Z",
      mode_group: "ladder",
      duel: false,
      opponent: "Silent_Hobbit",
      crowns: 2,
      crowns_against: 1,
      outcome: "win",
    },
    {
      url: "https://elixir.poapkings.com/battle/e4628278568a",
      battle_time: "2026-09-03T14:07:46.000Z",
      mode_group: "ladder",
      duel: false,
      opponent: "fiiko",
      crowns: 0,
      crowns_against: 3,
      outcome: "loss",
    },
  ],
  disclaimer:
    "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.",
};

export const DUEL = {
  battle: {
    id: "0e6ebdc395591504bf85750641c57454a88dd6c4024e6beb53cca82e3ea25a7c",
    short_id: "0e6ebdc39559",
    url: "https://elixir.poapkings.com/battle/0e6ebdc39559",
    image: null,
    battle_time: "2026-09-03T12:00:48.000Z",
    type: "riverRaceDuelColosseum",
    kind: "duel",
    mode_group: "war",
    game_mode: {
      id: 72000267,
      name: "CW_Duel_1v1",
    },
    arena: {
      id: 54000144,
      name: "Spirit Square",
    },
    duration: null,
    deck_level_edge: null,
  },
  sides: [
    {
      outcome: "win",
      crowns: 4,
      tower_hp: {
        king: 7728,
        princess: [3807, 706],
      },
      players: [
        {
          player_tag: "#JYRQ8U92C",
          name: "sikander sidhu",
          clan_tag: "#J2RGCRVG",
          clan_name: null,
          starting_trophies: 13592,
          trophy_change: null,
          global_rank: null,
          elixir_leaked: 46.33,
          deck: null,
          rounds: [
            {
              cards: [
                {
                  id: 26000055,
                  name: "Mega Knight",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000102,
                  name: "Berserker",
                  form: "hero",
                  level: 16,
                },
                {
                  id: 26000011,
                  name: "Valkyrie",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000001,
                  name: "Archers",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000101,
                  name: "Rune Giant",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000008,
                  name: "Barbarians",
                  form: "base",
                  level: 15,
                },
                {
                  id: 28000005,
                  name: "Freeze",
                  form: "base",
                  level: 15,
                },
                {
                  id: 27000006,
                  name: "Tesla",
                  form: "base",
                  level: 15,
                },
              ],
              tower_troop: null,
              label: "Beatdown",
              average_elixir: 4.13,
              cycle4: 13,
              average_level: 15.63,
            },
            {
              cards: [
                {
                  id: 26000005,
                  name: "Minions",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000018,
                  name: "Mini P.E.K.K.A",
                  form: "hero",
                  level: 15,
                },
                {
                  id: 26000035,
                  name: "Lumberjack",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 28000001,
                  name: "Arrows",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000026,
                  name: "Princess",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000021,
                  name: "Hog Rider",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000020,
                  name: "Giant Skeleton",
                  form: "base",
                  level: 15,
                },
                {
                  id: 26000016,
                  name: "Prince",
                  form: "base",
                  level: 16,
                },
              ],
              tower_troop: null,
              label: "Beatdown",
              average_elixir: 4,
              cycle4: 13,
              average_level: 15.75,
            },
            {
              cards: [
                {
                  id: 26000064,
                  name: "Firecracker",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000074,
                  name: "Golden Knight",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000047,
                  name: "Royal Recruits",
                  form: "evolution",
                  level: 15,
                },
                {
                  id: 27000004,
                  name: "Bomb Tower",
                  form: "base",
                  level: 16,
                },
                {
                  id: 27000003,
                  name: "Inferno Tower",
                  form: "base",
                  level: 15,
                },
                {
                  id: 26000012,
                  name: "Skeleton Army",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000040,
                  name: "Dart Goblin",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000043,
                  name: "Elite Barbarians",
                  form: "base",
                  level: 16,
                },
              ],
              tower_troop: null,
              label: "Beatdown",
              average_elixir: 4.38,
              cycle4: 13,
              average_level: 15.75,
            },
          ],
        },
      ],
    },
    {
      outcome: "loss",
      crowns: 3,
      tower_hp: {
        king: 7728,
        princess: [4487, 0],
      },
      players: [
        {
          player_tag: "#UPJU8VJ09",
          name: "Hydra",
          clan_tag: "#GQVLU28J",
          clan_name: null,
          starting_trophies: 12115,
          trophy_change: null,
          global_rank: null,
          elixir_leaked: 1.46,
          deck: null,
          rounds: [
            {
              cards: [
                {
                  id: 26000015,
                  name: "Baby Dragon",
                  form: "evolution",
                  level: 15,
                },
                {
                  id: 26000018,
                  name: "Mini P.E.K.K.A",
                  form: "hero",
                  level: 15,
                },
                {
                  id: 26000045,
                  name: "Executioner",
                  form: "evolution",
                  level: 14,
                },
                {
                  id: 26000014,
                  name: "Musketeer",
                  form: "base",
                  level: 14,
                },
                {
                  id: 26000068,
                  name: "Battle Healer",
                  form: "base",
                  level: 15,
                },
                {
                  id: 26000067,
                  name: "Elixir Golem",
                  form: "base",
                  level: 15,
                },
                {
                  id: 28000015,
                  name: "Barbarian Barrel",
                  form: "base",
                  level: 15,
                },
                {
                  id: 28000008,
                  name: "Zap",
                  form: "base",
                  level: 15,
                },
              ],
              tower_troop: null,
              label: "Control",
              average_elixir: 3.5,
              cycle4: 11,
              average_level: 14.75,
            },
            {
              cards: [
                {
                  id: 27000006,
                  name: "Tesla",
                  form: "evolution",
                  level: 15,
                },
                {
                  id: 26000074,
                  name: "Golden Knight",
                  form: "base",
                  level: 15,
                },
                {
                  id: 26000011,
                  name: "Valkyrie",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000030,
                  name: "Ice Spirit",
                  form: "base",
                  level: 15,
                },
                {
                  id: 26000021,
                  name: "Hog Rider",
                  form: "base",
                  level: 14,
                },
                {
                  id: 26000064,
                  name: "Firecracker",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000044,
                  name: "Hunter",
                  form: "base",
                  level: 16,
                },
                {
                  id: 28000017,
                  name: "Giant Snowball",
                  form: "base",
                  level: 15,
                },
              ],
              tower_troop: null,
              label: "Cycle",
              average_elixir: 3.25,
              cycle4: 10,
              average_level: 15.25,
            },
            {
              cards: [
                {
                  id: 26000004,
                  name: "P.E.K.K.A",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000062,
                  name: "Magic Archer",
                  form: "hero",
                  level: 15,
                },
                {
                  id: 26000036,
                  name: "Battle Ram",
                  form: "evolution",
                  level: 16,
                },
                {
                  id: 26000013,
                  name: "Bomber",
                  form: "base",
                  level: 16,
                },
                {
                  id: 26000042,
                  name: "Electro Wizard",
                  form: "base",
                  level: 14,
                },
                {
                  id: 28000005,
                  name: "Freeze",
                  form: "base",
                  level: 14,
                },
                {
                  id: 27000000,
                  name: "Cannon",
                  form: "base",
                  level: 16,
                },
                {
                  id: 28000001,
                  name: "Arrows",
                  form: "base",
                  level: 15,
                },
              ],
              tower_troop: null,
              label: "Control",
              average_elixir: 3.88,
              cycle4: 12,
              average_level: 15.25,
            },
          ],
        },
      ],
    },
  ],
  games: [
    {
      round: 1,
      winner: "right",
      sides: [
        {
          crowns: 1,
          tower_hp: {
            king: 1146,
            princess: [0, 0],
          },
          elixir_leaked: 31.47,
        },
        {
          crowns: 2,
          tower_hp: {
            king: 7728,
            princess: [2108, 0],
          },
          elixir_leaked: 0.64,
        },
      ],
    },
    {
      round: 2,
      winner: "left",
      sides: [
        {
          crowns: 2,
          tower_hp: {
            king: 7728,
            princess: [3768, 0],
          },
          elixir_leaked: 8.56,
        },
        {
          crowns: 1,
          tower_hp: {
            king: 5583,
            princess: [0, 0],
          },
          elixir_leaked: 0.01,
        },
      ],
    },
    {
      round: 3,
      winner: "left",
      sides: [
        {
          crowns: 1,
          tower_hp: {
            king: 7728,
            princess: [3807, 706],
          },
          elixir_leaked: 6.3,
        },
        {
          crowns: 0,
          tower_hp: {
            king: 7728,
            princess: [4487, 0],
          },
          elixir_leaked: 0.81,
        },
      ],
    },
  ],
  meetings: [
    {
      url: "https://elixir.poapkings.com/battle/0e6ebdc39559",
      battle_time: "2026-09-03T12:00:48.000Z",
      mode_group: "war",
      duel: true,
      crowns: 4,
      crowns_against: 3,
      outcome: "win",
    },
  ],
  sitting: [
    {
      url: "https://elixir.poapkings.com/battle/0e6ebdc39559",
      battle_time: "2026-09-03T12:00:48.000Z",
      mode_group: "war",
      duel: true,
      opponent: "Hydra",
      crowns: 4,
      crowns_against: 3,
      outcome: "win",
    },
  ],
  disclaimer:
    "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.",
};
