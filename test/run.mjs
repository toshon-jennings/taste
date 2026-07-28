import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HALF_LIFE_DAYS, INJECT_FLOOR, confidence, decay, observe } from '../src/confidence.mjs';
import { projectRoot } from '../src/paths.mjs';
import { merge, parse, serialize, slug, upsert } from '../src/store.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-28T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- confidence

test('a brand-new observation is not yet believed', () => {
  const e = observe({ confirms: 0, contradicts: 0 }, 'confirm', { now: NOW });
  assert.equal(confidence(e, NOW).toFixed(2), '0.50');
  assert.ok(confidence(e, NOW) < 0.51, 'one sighting must stay below the injection floor');
});

test('repeated confirmations raise confidence monotonically', () => {
  let e = { confirms: 0, contradicts: 0 };
  let prev = 0;
  for (let i = 0; i < 8; i++) {
    e = observe(e, 'confirm', { now: NOW });
    const c = confidence(e, NOW);
    assert.ok(c > prev, `step ${i} did not increase`);
    prev = c;
  }
  assert.ok(prev > 0.7 && prev < 1, `8 confirmations should be confident but not certain, got ${prev}`);
});

test('one or two sightings stay below the injection floor, three clears it', () => {
  let e = { confirms: 0, contradicts: 0 };
  const at = [];
  for (let i = 0; i < 3; i++) {
    e = observe(e, 'confirm', { now: NOW });
    at.push(confidence(e, NOW));
  }
  assert.ok(at[0] < INJECT_FLOOR, `one sighting reached the model at ${at[0]}`);
  assert.ok(at[1] < INJECT_FLOOR, `two sightings reached the model at ${at[1]}`);
  assert.ok(at[2] >= INJECT_FLOOR, `three sightings did not reach the model at ${at[2]}`);
});

test('a stated preference clears the floor on its own', () => {
  const e = observe({ confirms: 0, contradicts: 0 }, 'confirm', { weight: 3, now: NOW });
  assert.ok(confidence(e, NOW) >= INJECT_FLOOR);
});

test('a contradiction pulls confidence back down', () => {
  let e = { confirms: 0, contradicts: 0 };
  for (let i = 0; i < 5; i++) e = observe(e, 'confirm', { now: NOW });
  const before = confidence(e, NOW);
  const after = confidence(observe(e, 'contradict', { now: NOW }), NOW);
  assert.ok(after < before, 'contradiction must lower confidence');
});

test('evidence decays with the stated half-life', () => {
  assert.equal(decay(HALF_LIFE_DAYS * DAY).toFixed(6), '0.500000');
  const e = { confirms: 10, contradicts: 0, last: iso(NOW - HALF_LIFE_DAYS * DAY) };
  const fresh = { confirms: 10, contradicts: 0, last: iso(NOW) };
  assert.ok(confidence(e, NOW) < confidence(fresh, NOW), 'stale evidence must count for less');
});

test('decayed running totals match replaying the event list', () => {
  // Incremental decay-then-add is the cheap form of summing lambda^age per event.
  let incremental = { confirms: 0, contradicts: 0 };
  const times = [NOW - 200 * DAY, NOW - 120 * DAY, NOW - 30 * DAY];
  for (const t of times) incremental = observe(incremental, 'confirm', { now: t });
  const replayed = times.reduce((sum, t) => sum + decay(NOW - t), 0);
  const incrementalAtNow = incremental.confirms * decay(NOW - Date.parse(incremental.last));
  assert.ok(Math.abs(replayed - incrementalAtNow) < 0.01, `${replayed} vs ${incrementalAtNow}`);
});

// --------------------------------------------------------------------- store

test('parse and serialize round-trip', () => {
  const data = { package: 'typescript', entries: [] };
  upsert(data, 'Prefer type aliases over interfaces', 'confirm', { note: 'seen in api/', source: 'edit', now: NOW });
  upsert(data, 'Never use default exports', 'confirm', { source: 'stated', now: NOW });
  const round = parse(serialize(data));
  assert.equal(round.package, 'typescript');
  assert.equal(round.entries.length, 2);
  const e = round.entries.find((x) => x.id === slug('Never use default exports'));
  assert.equal(e.rule, 'Never use default exports');
  assert.deepEqual(e.sources, ['stated']);
  assert.equal(e.confirms, 1);
});

test('upsert matches an existing rule instead of duplicating it', () => {
  const data = { package: 'cli', entries: [] };
  upsert(data, 'Prefer flags over positional args', 'confirm', { now: NOW });
  const { isNew } = upsert(data, 'prefer flags over positional args', 'confirm', { now: NOW });
  assert.equal(isNew, false);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].confirms, 2);
});

test('entries serialize highest-confidence first', () => {
  const data = { package: 'x', entries: [] };
  upsert(data, 'Weak rule', 'confirm', { now: NOW });
  for (let i = 0; i < 5; i++) upsert(data, 'Strong rule', 'confirm', { now: NOW });
  const order = parse(serialize(data)).entries.map((e) => e.rule);
  assert.deepEqual(order, ['Strong rule', 'Weak rule']);
});

test('malformed metadata survives parsing and is flagged', () => {
  const text = '## Some rule\n<!-- taste {not json} -->\n';
  const e = parse(text).entries[0];
  assert.equal(e.rule, 'Some rule');
  assert.ok(e._malformed, 'lint needs to see that the metadata was unreadable');
});

test('a hand-written heading with no metadata still parses', () => {
  const e = parse('# notes\n\n## Keep functions under 40 lines\n\nBecause reviews.\n').entries[0];
  assert.equal(e.id, 'keep-functions-under-40-lines');
  assert.equal(e.confirms, 0);
  assert.equal(e.note, 'Because reviews.');
});

test('merge unions by id without inflating evidence', () => {
  const a = { package: 'p', entries: [] };
  upsert(a, 'Shared rule', 'confirm', { now: NOW });
  upsert(a, 'Shared rule', 'confirm', { now: NOW });
  upsert(a, 'Only local', 'confirm', { now: NOW });
  const b = { package: 'p', entries: [] };
  upsert(b, 'Shared rule', 'confirm', { now: NOW });
  upsert(b, 'Only remote', 'confirm', { now: NOW });

  const { data, added, updated } = merge(a, b);
  assert.equal(added, 1, 'one genuinely new rule');
  assert.equal(updated, 1, 'one rule known on both sides');
  assert.equal(data.entries.length, 3);
  const shared = data.entries.find((e) => e.id === slug('Shared rule'));
  assert.equal(shared.confirms, 2, 'max, not sum — a round trip must not manufacture confidence');
});

test('merging the same package twice is idempotent', () => {
  const a = { package: 'p', entries: [] };
  upsert(a, 'Stable rule', 'confirm', { now: NOW });
  const once = merge({ package: 'p', entries: [] }, a).data;
  const twice = merge(once, a).data;
  assert.equal(twice.entries.length, 1);
  assert.equal(twice.entries[0].confirms, once.entries[0].confirms);
});

test('slug is stable and bounded', () => {
  assert.equal(slug('Prefer `type` over interface!'), 'prefer-type-over-interface');
  assert.ok(slug('x'.repeat(200)).length <= 60);
  assert.equal(slug('!!!'), 'entry');
});

// -------------------------------------------------------------------- paths

test('an unmarked directory resolves to itself, not to an ancestor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-'));
  try {
    delete process.env.CLAUDE_PROJECT_DIR;
    assert.equal(projectRoot(dir), resolve(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLAUDE_PROJECT_DIR wins when Claude Code sets it', () => {
  process.env.CLAUDE_PROJECT_DIR = '/somewhere/else';
  try {
    assert.equal(projectRoot('/tmp'), '/somewhere/else');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
  }
});

console.log(`${passed} passed${process.exitCode ? ', with failures' : ''}`);
