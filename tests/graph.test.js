import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine as E } from '../src/engine.js';
import { feedbackForMove, playLayout, scrollForLayoutChange } from '../src/graph.js';

const level = { w: ['8', '0', '4', '12'], t: 3, e: [[0,1], [1,2], [2,3]] };

test('opening highlights the complete participating group and exact per-container changes', () => {
  const before = E.move(level, E.initial(level), 0);
  const info = E.inspectMove(level, before, 1), feedback = feedbackForMove(level, before, info);
  assert.equal(feedback.edge, 1); assert.equal(feedback.opened, true);
  assert.deepEqual(feedback.group, [0,1,2]);
  assert.deepEqual(feedback.changes.map(change => change.text), ['不变','不变','不变']);
  assert.equal(E.str(info.next.w[3]), '12');
  const next = E.inspectMove(level, info.next, 2), move = feedbackForMove(level, info.next, next);
  assert.deepEqual(move.group, [0,1,2,3]);
  assert.deepEqual(move.changes.map(change => change.text), ['+2','+2','+2','−6']);
  assert.equal(E.str(E.sum(move.changes.map(change => change.amount))), '0');
});

test('closing reports the resulting groups while retaining every exact water amount', () => {
  const before = E.replay(level, [0,1,2]).at(-1);
  const info = E.inspectMove(level, before, 1), feedback = feedbackForMove(level, before, info);
  assert.equal(feedback.edge, 1); assert.equal(feedback.opened, false);
  assert.deepEqual(feedback.parts, [[0,1],[2,3]]);
  assert.deepEqual(info.next.w.map(E.str), before.w.map(E.str));
  assert.ok(feedback.changes.every(change => change.sign === 0));
});

test('closing one edge in a cycle does not invent an isolated group', () => {
  const cycle = { w: ['1','2','3'], t: 0, e: [[0,1],[1,2],[0,2]] };
  const before = E.replay(cycle, [0,1,2]).at(-1);
  const feedback = feedbackForMove(cycle, before, E.inspectMove(cycle, before, 2));
  assert.deepEqual(feedback.parts, [[0,1,2]]);
});

test('resizing a centered desktop graph to phone keeps the same graph point centered', () => {
  const positions = [[100,200],[250,200],[400,200],[550,200],[700,200]];
  const desktop = { width: 1100, height: 600 }, phone = { width: 390, height: 450 };
  const before = playLayout(positions, desktop.width-1, desktop.height-1);
  const after = playLayout(positions, phone.width-1, phone.height-1);
  const scroll = [Math.max(0,before.positions[2][0]-desktop.width/2), Math.max(0,before.positions[2][1]-desktop.height/2)];
  const next = scrollForLayoutChange(before, after, scroll, desktop, phone);
  // The layout reserves one pixel to avoid a rounding-only scrollbar.
  assert.ok(Math.abs(after.positions[2][0] - next[0] - phone.width/2) < .51);
  // The vertical canvas already fits, so no scroll is needed in that direction.
  assert.equal(next[1], 0);
});

test('resizing preserves a manually panned view rather than returning to the target', () => {
  const positions = [[0,0],[150,0],[300,0],[450,0],[600,0],[750,0]];
  const wide = { width: 480, height: 500 }, narrow = { width: 390, height: 500 };
  const before = playLayout(positions, wide.width-1, wide.height-1);
  const after = playLayout(positions, narrow.width-1, narrow.height-1);
  const scroll = [before.positions[3][0]-wide.width/2, 0];
  const next = scrollForLayoutChange(before, after, scroll, wide, narrow);
  assert.ok(Math.abs(after.positions[3][0] - next[0] - narrow.width/2) < 1e-8);
  assert.notEqual(next[0], Math.max(0, after.positions[0][0] - narrow.width/2));
});

test('a resize to a wider viewport clamps the preserved point to the canvas bounds', () => {
  const positions = [[0,0],[150,0],[300,0],[450,0]];
  const phone = { width: 320, height: 500 }, desktop = { width: 1100, height: 600 };
  const before = playLayout(positions, phone.width-1, phone.height-1);
  const after = playLayout(positions, desktop.width-1, desktop.height-1);
  assert.deepEqual(scrollForLayoutChange(before, after, [100,0], phone, desktop), [0,0]);
});
