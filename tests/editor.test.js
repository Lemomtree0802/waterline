import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorHistory, graphSnapshot, connectNodes, removeNode, tidyLayout, newDraft } from '../src/editor.js';

const draft = () => ({ name: 'My level', w: ['1', '2', '3', '4'], t: 2, e: [[0, 1], [1, 2], [2, 3]], pos: [[100, 200], [250, 200], [400, 200], [550, 200]] });

test('connecting two nodes adds a canonical edge without toggling an existing edge', () => {
  const p = draft();
  assert.equal(connectNodes(p, 3, 0), true);
  assert.deepEqual(p.e, [[0, 1], [0, 3], [1, 2], [2, 3]]);
  assert.equal(connectNodes(p, 0, 3), false);
  assert.equal(connectNodes(p, 1, 1), false);
  assert.equal(p.e.length, 4);
});
test('deleting a node removes incident edges and keeps target and positions aligned', () => {
  const p = draft(); removeNode(p, 1);
  assert.deepEqual(p.w, ['1', '3', '4']); assert.equal(p.t, 1);
  assert.deepEqual(p.e, [[1, 2]]); assert.deepEqual(p.pos, [[100, 200], [400, 200], [550, 200]]);
  removeNode(p, 1); assert.equal(p.t, 0); assert.deepEqual(p.e, []);
  removeNode(p, 0); assert.equal(p.w.length, 1); assert.equal(p.t, 0);
  removeNode(p, 0); assert.equal(p.t, -1); assert.deepEqual(p.pos, []);
  assert.throws(() => removeNode(p, 0), /不存在/);
});

test('new drafts start empty and undo can restore the last deleted node', () => {
  const p = newDraft(), history = new EditorHistory();
  assert.deepEqual(graphSnapshot(p), {w:[], e:[], t:-1, pos:[]});
  p.w.push('3/4'); p.pos.push([280,240]); p.t = 0;
  const before = graphSnapshot(p); removeNode(p, 0); history.record(before, p);
  assert.equal(p.t, -1); history.undo(p);
  assert.deepEqual(graphSnapshot(p), before);
});
test('undo restores deleted graph structure and dragged positions without changing the title', () => {
  const p = draft(), history = new EditorHistory(), original = graphSnapshot(p);
  removeNode(p, 0); history.record(original, p); p.name = 'Renamed';
  assert.equal(history.undo(p), true); assert.deepEqual(graphSnapshot(p), original); assert.equal(p.name, 'Renamed');
  assert.equal(history.redo(p), true); assert.equal(p.w.length, 3);
  const beforeDrag = graphSnapshot(p); p.pos[0] = [600, 100]; history.record(beforeDrag, p);
  history.undo(p); assert.deepEqual(p.pos[0], beforeDrag.pos[0]);
  const beforeWater = graphSnapshot(p); p.w[0] = '7/4'; history.record(beforeWater, p);
  assert.equal(history.future.length, 0); assert.equal(history.redo(p), false);
  assert.equal(history.record(graphSnapshot(p), p), false);
});
test('tidying straightens nearly horizontal chains and vertical edges consistently', () => {
  const p = { ...draft(), e: [[0, 1], [1, 2], [2, 3]], pos: [[100, 200], [300, 212], [500, 205], [508, 380]] };
  const original = graphSnapshot(p), history = new EditorHistory();
  assert.equal(tidyLayout(p), true);
  assert.equal(p.pos[0][1], p.pos[1][1]); assert.equal(p.pos[1][1], p.pos[2][1]);
  assert.equal(p.pos[2][0], p.pos[3][0]);
  assert.deepEqual({ ...graphSnapshot(p), pos: original.pos }, original);
  history.record(original, p); history.undo(p); assert.deepEqual(graphSnapshot(p), original);
});
test('tidying preserves 50-degree edges, isolated nodes, and already tidy layouts', () => {
  const p = { ...draft(), e: [[0, 1]], pos: [[100, 100], [300, 100 + 200 * Math.tan(50 * Math.PI / 180)], [500, 90], [600, 300]] };
  const original = graphSnapshot(p); assert.equal(tidyLayout(p), false); assert.deepEqual(graphSnapshot(p), original);
  p.pos[1] = [300, 100]; assert.equal(tidyLayout(p), false);
});
test('tidying a slightly skewed rectangle is stable when repeated', () => {
  const p = { ...draft(), e: [[0, 1], [0, 2], [1, 3], [2, 3]], pos: [[100, 100], [300, 109], [108, 300], [306, 310]] };
  assert.equal(tidyLayout(p), true); const once = graphSnapshot(p);
  assert.equal(p.pos[0][0], p.pos[2][0]); assert.equal(p.pos[1][0], p.pos[3][0]);
  assert.equal(p.pos[0][1], p.pos[1][1]); assert.equal(p.pos[2][1], p.pos[3][1]);
  assert.equal(tidyLayout(p), false); assert.deepEqual(graphSnapshot(p), once);
});
test('tidying never introduces a new node overlap', () => {
  const p = { ...draft(), e: [[0, 1]], pos: [[100, 200], [300, 220], [100, 280], [600, 350]] };
  const original = graphSnapshot(p); tidyLayout(p);
  for (let i = 0; i < p.pos.length; i++) for (let j = i + 1; j < p.pos.length; j++) {
    assert.ok(Math.hypot(p.pos[i][0] - p.pos[j][0], p.pos[i][1] - p.pos[j][1]) >= Math.min(80, Math.hypot(original.pos[i][0] - original.pos[j][0], original.pos[i][1] - original.pos[j][1])) - 1e-7);
  }
});
