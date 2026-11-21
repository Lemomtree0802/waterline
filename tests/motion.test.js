import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidMotion, WATER_FLOW_MS } from '../src/motion.js';

function fixture(reduced = false) {
  let time = 0, next = 0, values;
  const frames = new Map();
  const motion = new LiquidMotion(water => { values = water.slice(); }, {
    request: callback => { frames.set(++next, callback); return next; },
    cancel: id => frames.delete(id), now: () => time, reduced: () => reduced,
  });
  return {motion, frames, get values() { return values; },
    advance(to) { time = to; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); },
  };
}

test('equalization shows the exact destination immediately and holds a brief action interval', async () => {
  const view = fixture(), settled = view.motion.move([0, 1, .2], [.5, .5, .2]);
  assert.equal(WATER_FLOW_MS, 240);
  assert.deepEqual(view.values, [.5, .5, .2]);
  assert.ok(view.motion.pending);
  view.advance(WATER_FLOW_MS / 2); assert.deepEqual(view.values, [.5, .5, .2]);
  assert.ok(view.motion.pending);
  view.advance(WATER_FLOW_MS);
  assert.equal(await settled, true); assert.deepEqual(view.values, [.5,.5,.2]);
  assert.equal(view.motion.pending, null);
});

test('a newer action cancels stale completion and displays the new exact state', async () => {
  const view = fixture(), first = view.motion.move([0,1], [.5,.5]);
  view.advance(80); const before = view.values.slice();
  const latest = view.motion.move(before, [.25,.75]);
  assert.equal(await first, false); assert.deepEqual(view.values, [.25,.75]);
  view.advance(80 + WATER_FLOW_MS); assert.equal(await latest, true); assert.deepEqual(view.values, [.25,.75]);
});

test('an immediate update cancels the presentation interval even for the same destination', async () => {
  const view = fixture(), first = view.motion.move([0,1], [.5,.5]);
  view.advance(80);
  const same = view.motion.move(view.values, [.5,.5], false);
  assert.equal(await first, false); assert.equal(await same, true);
  assert.equal(view.frames.size, 0); assert.equal(view.motion.pending, null);
  assert.deepEqual(view.values, [.5,.5]);
});

test('undoing to an earlier state cancels the flash and restores that water immediately', async () => {
  const view = fixture(), first = view.motion.move([0,1], [.5,.5]);
  view.advance(80);
  assert.equal(await view.motion.move(view.values, [0,1], false), true);
  assert.equal(await first, false); assert.deepEqual(view.values, [0,1]);
  assert.equal(view.frames.size, 0);
});

test('leaving the graph cancels frames; reduced motion reaches the exact destination immediately', async () => {
  const view = fixture(), pending = view.motion.move([0,1], [.5,.5]);
  view.motion.cancel(); assert.equal(await pending, false); assert.equal(view.frames.size, 0);
  const quiet = fixture(true);
  assert.equal(await quiet.motion.move([0,1], [.5,.5]), true);
  assert.equal(quiet.frames.size, 0); assert.deepEqual(quiet.values, [.5,.5]);
});
