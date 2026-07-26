import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

// Fixed reference day (2024-01-10, arbitrary) so the schedule-boundary math
// below is deterministic and easy to reason about in UTC.
const DAY_MS = 86_400_000;
const MIDNIGHT = Date.UTC(2024, 0, 10, 0, 0, 0);
const NINE_AM = MIDNIGHT + 9 * 60 * 60_000; // 09:00 UTC
const NINE_PM = MIDNIGHT + 21 * 60 * 60_000; // 21:00 UTC
const NEXT_DAY_NINE_AM = NINE_AM + DAY_MS;
const NEXT_DAY_NINE_PM = NINE_PM + DAY_MS;

function fixture({ now: initialNow = MIDNIGHT, playerCount = 5 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-async-'));
  let now = initialNow;
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => now, random: () => 0.9 });
  return {
    manager,
    setNow(v) { now = v; },
    close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function createAsyncGame(f, options = {}) {
  const { code } = f.manager.create({ playerCode: 'p0', name: 'P0', mode: 'async', options });
  for (let i = 1; i < 5; i++) {
    f.manager.join({ code, playerCode: `p${i}`, name: `P${i}` });
    f.manager.ready(code, `p${i}`, true);
  }
  return code;
}

test('async create(): defaults to 09:00 UTC day-start and locks day/night at 12h each', () => {
  const f = fixture();
  try {
    const code = createAsyncGame(f);
    const g = f.manager.game(code);
    assert.equal(g.day_start_minute_utc, 540, 'defaults to 09:00 UTC (540 minutes)');
    assert.equal(g.day_ms, 43_200_000, 'day locked at 12h');
    assert.equal(g.night_ms, 43_200_000, 'night locked at 12h');
  } finally { f.close(); }
});

test('async create(): a live (non-async) game gets no day_start_minute_utc', () => {
  const f = fixture();
  try {
    const { code } = f.manager.create({ playerCode: 'p0', name: 'P0', mode: 'live' });
    const g = f.manager.game(code);
    assert.equal(g.day_start_minute_utc, null);
  } finally { f.close(); }
});

test('async create(): explicit dayStartMinuteUtc is honored and out-of-range values clamp', () => {
  const f = fixture();
  try {
    const code1 = createAsyncGame(f, { dayStartMinuteUtc: 90 });
    assert.equal(f.manager.game(code1).day_start_minute_utc, 90, '01:30 UTC honored');
  } finally { f.close(); }

  const f2 = fixture();
  try {
    const code2 = createAsyncGame(f2, { dayStartMinuteUtc: -50 });
    assert.equal(f2.manager.game(code2).day_start_minute_utc, 0, 'negative clamps to 0');
  } finally { f2.close(); }

  const f3 = fixture();
  try {
    const code3 = createAsyncGame(f3, { dayStartMinuteUtc: 5000 });
    assert.equal(f3.manager.game(code3).day_start_minute_utc, 1439, 'out-of-range clamps to 23:59');
  } finally { f3.close(); }
});

test('async configure(): updates day_start_minute_utc and ignores dayMs/nightMs overrides (stays locked at 12h)', () => {
  const f = fixture();
  try {
    const code = createAsyncGame(f);
    f.manager.configure(code, 'p0', { dayStartMinuteUtc: 1020, dayMs: 999_999, nightMs: 111_111 });
    const g = f.manager.game(code);
    assert.equal(g.day_start_minute_utc, 1020, '17:00 UTC applied');
    assert.equal(g.day_ms, 43_200_000, 'dayMs override ignored, still 12h');
    assert.equal(g.night_ms, 43_200_000, 'nightMs override ignored, still 12h');
  } finally { f.close(); }
});

test('live configure(): unaffected — dayMs/nightMs remain configurable, day_start_minute_utc stays null', () => {
  const f = fixture();
  try {
    const { code } = f.manager.create({ playerCode: 'p0', name: 'P0', mode: 'live' });
    for (let i = 1; i < 5; i++) { f.manager.join({ code, playerCode: `p${i}`, name: `P${i}` }); f.manager.ready(code, `p${i}`, true); }
    f.manager.configure(code, 'p0', { dayMs: 200_000, nightMs: 150_000 });
    const g = f.manager.game(code);
    assert.equal(g.day_ms, 200_000);
    assert.equal(g.night_ms, 150_000);
    assert.equal(g.day_start_minute_utc, null);
  } finally { f.close(); }
});

test('async start(): now before today\'s day-start (i.e. still within the night window) → Day 1 deadline clips to tonight\'s night-start, NOT today\'s day-start', () => {
  // Regression test: 03:00 UTC sits inside the night window (21:00 the
  // previous day through 09:00 today). start() always creates the game in
  // 'day' phase, so Day 1's deadline must be the next NIGHT-start (21:00
  // today), never the next day-start — picking day-start here would make
  // this "Day 1" straddle what should still be night, and since every later
  // boundary is a fixed +12h step from this first one, that single wrong
  // pick would permanently swap which 12h half of the day is labelled day
  // vs night for the rest of the game.
  const f = fixture({ now: MIDNIGHT + 3 * 60 * 60_000 }); // 03:00 UTC
  try {
    const code = createAsyncGame(f);
    const result = f.manager.start(code, 'p0');
    assert.equal(result.deadline, NINE_PM, 'clips forward to 21:00 UTC, the upcoming night-start boundary');
  } finally { f.close(); }
});

test('async start(): now within the day window → Day 1 deadline clips to tonight\'s night-start (day-start+12h)', () => {
  const f = fixture({ now: NINE_AM + 4 * 60 * 60_000 }); // 13:00 UTC, inside the 09:00-21:00 day window
  try {
    const code = createAsyncGame(f);
    const result = f.manager.start(code, 'p0');
    assert.equal(result.deadline, NINE_PM, 'clips forward to 21:00 UTC — Day 1 is short, but Night 1 onward aligns to the schedule');
  } finally { f.close(); }
});

test('async start(): now within the night window, after tonight\'s night-start has passed → Day 1 deadline clips to tomorrow\'s night-start, NOT tomorrow\'s day-start', () => {
  // Same regression as above from the other side: 23:00 UTC is 2h past
  // tonight's 21:00 night-start, so the next night-start is a full day
  // away. This is the exact scenario reported live — a host starting an
  // async game shortly after the configured night-start time, which used
  // to lock onto the (nearer) day-start instead and swap the schedule.
  const f = fixture({ now: NINE_PM + 2 * 60 * 60_000 }); // 23:00 UTC, inside the 21:00-09:00 night window
  try {
    const code = createAsyncGame(f);
    const result = f.manager.start(code, 'p0');
    assert.equal(result.deadline, NEXT_DAY_NINE_PM, 'clips forward to tomorrow 21:00 UTC — the next night-start, a full day out');
  } finally { f.close(); }
});

test('async start(): every subsequent phase after the clipped Day 1 lands exactly on the 09:00/21:00 UTC schedule', () => {
  const f = fixture({ now: NINE_AM + 4 * 60 * 60_000 }); // 13:00 UTC start → Day 1 clips to 21:00 UTC
  try {
    const code = createAsyncGame(f);
    f.manager.start(code, 'p0');
    f.setNow(NINE_PM);
    f.manager.resolve(code, true); // Day 1 -> Night 1
    const afterNight1 = f.manager.game(code);
    assert.equal(afterNight1.phase, 'night');
    assert.equal(afterNight1.deadline, NINE_PM + 43_200_000, 'Night 1 ends exactly 12h later, at 09:00 UTC tomorrow');
    assert.equal(afterNight1.deadline, NEXT_DAY_NINE_AM);
  } finally { f.close(); }
});
