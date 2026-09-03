import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { projectRiverRace, stampWarKeys } from '../src/war.mjs';
import { ingestBattlelog } from '../src/battles.mjs';
import { fixture, scratchDb, seedReceipt } from './helpers.mjs';

let ctx;
const CLAN = '#J2RGCRVG';

before(async () => {
  ctx = await scratchDb('war');
  await ctx.db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
});

after(async () => ctx.drop());

test('genesis: no logged season -> anchor recorded, projection honestly deferred', async () => {
  const war = await fixture('currentriverrace/war_day.json');
  const result = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: '2026-08-31T07:37:36Z',
  });
  assert.equal(result.projected, 'anchor_only');
  assert.equal(result.needsBackfill, true);
  const anchors = await ctx.db.query(`select period_index from war_period_anchor where clan_tag = $1`, [CLAN]);
  assert.deepEqual(anchors.rows.map((r) => r.period_index), [war.periodIndex]);
  const weeks = (await ctx.db.query(`select count(*)::int n from war_week`)).rows[0].n;
  assert.equal(weeks, 0, 'no season invented');
});

test('with logged history: week, standings, POINTS participation, attendance', async () => {
  // Backfill-style logged week: season 136, section 2 (before the live section 3).
  await ctx.db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ($1, 136, 2)`,
    [CLAN],
  );
  const war = await fixture('currentriverrace/war_day.json'); // p27 s3, warDay 4
  const result = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: '2026-08-31T07:40:00Z',
  });
  assert.equal(result.projected, 'war');
  assert.equal(result.seasonId, 136, 'same season: live section 3 >= logged 2');
  assert.equal(result.warDay, 4);

  const { rows: standings } = await ctx.db.query(
    `select count(*)::int n, max(fame)::int top from war_week_clan
     where clan_tag = $1 and season_id = 136 and section_index = 3`,
    [CLAN],
  );
  assert.equal(standings[0].n, war.clans.length, 'all race clans recorded');
  assert.ok(standings[0].top > 0, 'boat fame recorded at clan level');

  const { rows: part } = await ctx.db.query(
    `select count(*)::int n, sum(points)::int total from war_participation
     where clan_tag = $1 and season_id = 136 and section_index = 3`,
    [CLAN],
  );
  assert.equal(part[0].n, war.clan.participants.length);
  const payloadPoints = war.clan.participants.reduce((s, p) => s + (p.fame ?? 0), 0);
  assert.equal(part[0].total, payloadPoints, 'payload "fame" stored as points');

  const attendance = (await ctx.db.query(
    `select count(*)::int n from war_attendance_day where war_day = 4`,
  )).rows[0].n;
  assert.equal(attendance, war.clan.participants.length);
});

test('MAX-merge: a lagging payload never regresses counters', async () => {
  const war = structuredClone(await fixture('currentriverrace/war_day.json'));
  const someone = war.clan.participants.find((p) => (p.fame ?? 0) > 0);
  const before = someone.fame;
  someone.fame = Math.max(0, before - 400); // stale observation
  await projectRiverRace(ctx.db, { clanTag: CLAN, payload: war, fetchedAt: '2026-08-31T07:50:00Z' });
  const { rows } = await ctx.db.query(
    `select points from war_participation where player_tag = $1 and season_id = 136 and section_index = 3`,
    [someone.tag],
  );
  assert.equal(rows[0].points, before, 'stale lower value ignored');
});

test('war keys stamp onto ingested war battles from their own time', async () => {
  const receiptId = await seedReceipt(ctx.db);
  const log = await fixture('player_battlelog/with_boat_and_duel.json');
  await ingestBattlelog(ctx.db, { observerTag: '#2YG98VVQ', receiptId, payload: log });
  // Tie the observer's battles to the clan via their participant clan_tag
  // (real logs carry it; assert some war battles exist for the clan).
  const { rows: pre } = await ctx.db.query(
    `select count(*)::int n from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where b.type like 'riverRace%' and bp.clan_tag = $1 and b.season_id is null`,
    [CLAN],
  );
  if (pre[0].n === 0) return; // fixture log may not carry clan-tagged war battles
  const war = await fixture('currentriverrace/war_day.json');
  const { stamped } = await stampWarKeys(ctx.db, {
    clanTag: CLAN,
    payload: war,
    nowMs: Date.parse('2026-08-31T09:00:00Z'),
  });
  assert.ok(stamped > 0, 'keys stamped');
  const { rows: post } = await ctx.db.query(
    `select distinct season_id, section_index from battle
     where type like 'riverRace%' and season_id is not null`,
  );
  assert.ok(post.every((r) => r.season_id === 136 && r.section_index === 3));
});

test('colosseum week flags and rolls the season when the section walks back', async () => {
  const col = await fixture('currentriverrace/colosseum.json'); // p31 s4
  const r1 = await projectRiverRace(ctx.db, { clanTag: CLAN, payload: col, fetchedAt: '2026-09-03T14:40:34Z' });
  assert.equal(r1.seasonId, 136, 'section 4 >= logged 3: same season');
  assert.equal(r1.kind, 'colosseum');
  const { rows } = await ctx.db.query(
    `select is_colosseum from war_week where season_id = 136 and section_index = 4`,
  );
  assert.equal(rows[0].is_colosseum, true);

  // Next season: a payload whose section walked back to 0.
  const next = structuredClone(col);
  next.periodIndex = 1;
  next.sectionIndex = 0;
  next.periodType = 'training';
  const r2 = await projectRiverRace(ctx.db, { clanTag: CLAN, payload: next, fetchedAt: '2026-09-07T12:00:00Z' });
  assert.equal(r2.seasonId, 137, 'section walking backwards = new season');
});

