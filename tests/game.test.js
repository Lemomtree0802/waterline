import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine as E } from '../src/engine.js';
import { GameSession, fixedScale, fillRatio, goalScore, hasReachedGoal, optimalScore, hasReachedMaximum, hasCompletedProgress, progressToKeep } from '../src/game.js';
import { officialLevels } from '../src/levels.js';
import { positionsFor, valvePositions, playLayout } from '../src/graph.js';

const singleValve = {source:'official', w:['0','12'], e:[[0,1]], t:0, goalWater:'5', optimalWater:'6'};
const twoValves = {source:'official', w:['2','0','2'], e:[[0,1],[1,2]], t:1, goalWater:'1'};
const relay = {source:'official', w:['0','0','14'], e:[[0,1],[1,2]], t:0, goalWater:'6'};

test('an invented board distinguishes the goal from its maximum', () => {
  assert.equal(E.str(goalScore(singleValve)), '5');
  assert.equal(E.str(E.theorem(singleValve).score), '6');
  assert.equal(E.str(optimalScore(singleValve)), '6');
  assert.equal(hasReachedGoal(singleValve, E.F(5)), true);
  assert.equal(hasReachedMaximum(singleValve, E.F(5)), false);
  assert.equal(hasReachedMaximum(singleValve, E.F(6)), true);
  assert.equal(hasCompletedProgress(singleValve, [0]), true);
  assert.equal(hasCompletedProgress({...singleValve,goalWater:undefined},[0]),false);
});

test('workshop and draft puzzles have no finish line or proven maximum', () => {
  const p = { ...twoValves, source: 'community', authorScore: '3/2', referenceScore: '3/2' };
  assert.equal(optimalScore(p), null);
  assert.equal(hasReachedMaximum(p, E.F(3, 4)), false);
  assert.equal(goalScore(p), null);
  assert.equal(hasReachedGoal(p, E.F(3, 4)), false);
  assert.equal(goalScore({ ...p, goalWater: '1' }), null);
  assert.equal(goalScore({ ...p, goalWater: undefined }), null);
  assert.equal(goalScore({ ...p, source: 'draft' }), null);
});

test('proven completion survives a fresh attempt, undo, and reset without restoring old valves', () => {
  const level = singleValve, saved = [0];
  const fresh = new GameSession(level);
  assert.equal(fresh.cursor, 0); assert.equal(fresh.state.mask, 0); assert.equal(E.str(fresh.score), '0');
  assert.equal(hasCompletedProgress(level, saved), true);
  assert.deepEqual(progressToKeep(level, fresh.activeMoves, saved), saved);
  fresh.act(0); fresh.undo(); fresh.reset();
  assert.deepEqual(progressToKeep(level, fresh.activeMoves, saved), saved);
  assert.equal(hasCompletedProgress(level, ['invalid']), false);
});

test('unfinished attempts remain available when no completed replay was saved', () => {
  const level = relay, moves = [0];
  assert.deepEqual(progressToKeep(level, moves, []), moves);
  const exploratory = relay, previous = [0];
  assert.equal(hasCompletedProgress(exploratory, previous), false);
  assert.deepEqual(progressToKeep(exploratory, [], previous), []);
});
test('closing valves retains water; reconnecting averages the whole component', () => {
  const p = twoValves;
  assert.equal(E.str(E.replay(p, [0, 0, 1]).at(-1).w[1]), '3/2');
  assert.equal(E.str(E.replay(p, [0, 1]).at(-1).w[1]), '4/3');
  assert.deepEqual(E.replay(p, [0])[1].w, E.replay(p, [0, 0])[2].w);
});
test('unrelated water changes never rescale a node liquid level', () => {
  const p = E.validate({ w: ['10', '6', '0', '20'], e: [[0, 1], [1, 2], [2, 3]], t: 0 });
  const scale = fixedScale(p), before = E.initial(p), after = E.move(p, before, 2);
  assert.equal(fillRatio(before.w[0], scale), .5);
  assert.equal(fillRatio(after.w[0], scale), .5);
  assert.equal(fillRatio(E.F(0), scale), 0);
  assert.equal(fillRatio(E.F(0), E.F(0)), 0);
});
test('unlimited operations, undo, redo and a new branch preserve correct state', () => {
  const p = singleValve, game = new GameSession(p);
  for (let i = 0; i < 1200; i++) game.act(0);
  assert.equal(game.cursor, 1200);
  assert.equal(E.str(game.score), '6');
  assert.equal(E.str(E.replay(p, game.activeMoves).at(-1).w[0]), '6');
  game.undo(); game.redo(); assert.equal(game.cursor, 1200);
  game.undo(); game.act(0); assert.equal(game.moves.length, 1200);
  game.reset(); assert.equal(game.cursor, 0); assert.equal(E.str(game.score), '0');
  assert.equal(game.canUndo, true);
  game.undo(); assert.equal(game.cursor, 1200); assert.equal(E.str(game.score), '6');
  game.redo(); assert.equal(game.cursor, 0); assert.equal(E.str(game.score), '0');
});
test('restart, subsequent moves, undo and redo cross attempt boundaries without losing the replay', () => {
  const level = twoValves;
  const game = new GameSession(level, [0, 0, 1], { assisted: true });
  assert.equal(game.assisted, true);
  game.reset();
  assert.deepEqual(game.activeMoves, []);
  assert.equal(game.state.mask, 0);
  assert.equal(game.canUndo, true);
  assert.equal(game.canRedo, false);
  game.act(1);
  game.undo(); game.undo();
  assert.deepEqual(game.activeMoves, [0, 0, 1]);
  assert.equal(E.str(game.score), '3/2');
  game.redo();
  assert.deepEqual(game.activeMoves, []);
  game.redo();
  assert.deepEqual(game.activeMoves, [1]);
  assert.equal(E.str(game.score), '1');
  assert.equal(game.assisted, true);
  game.undo(); game.undo();
  game.act(1);
  assert.deepEqual(game.activeMoves, [0, 0, 1, 1]);
  assert.equal(game.canRedo, false);
  assert.deepEqual(game.state, E.replay(level, game.activeMoves).at(-1));
  assert.equal(new GameSession(level).assisted, false);
});

test('multiple restarts and branching after an undo retain the correct attempt state', () => {
  const level = twoValves, game = new GameSession(level);
  game.act(0); game.reset(); game.act(1); game.reset();
  game.undo(); assert.deepEqual(game.activeMoves, [1]);
  game.undo(); assert.deepEqual(game.activeMoves, []);
  game.undo(); assert.deepEqual(game.activeMoves, [0]);
  game.undo(); assert.deepEqual(game.activeMoves, []);
  assert.equal(game.canUndo, false);
  for (let i = 0; i < 4; i++) game.redo();
  assert.deepEqual(game.activeMoves, []);
  assert.equal(game.canRedo, false);
  game.undo(); game.undo(); game.act(0);
  assert.deepEqual(game.activeMoves, [0]);
  assert.equal(game.canRedo, false);
  assert.deepEqual(game.state, E.replay(level, game.activeMoves).at(-1));
});
test('malformed puzzles and forged replay scores are rejected', () => {
  assert.throws(() => E.validate({ w: ['1', '0', '0'], t: 0, e: [[0, 1]] }), /连通/);
  assert.throws(() => E.parse('1/0'), /分母/);
  assert.throws(() => E.importRun({ schema: 'waterline-run-v1', puzzle: singleValve, moves: [0], ops: 1, score: '999' }), /校验/);
});

test('official valve controls remain outside node shells in dense graphs', () => {
  for (const level of officialLevels.slice(0,6)) {
    const positions = positionsFor(level), valves = valvePositions(level, positions);
    for (const valve of valves) for (const node of positions) {
      assert.ok(Math.hypot(valve[0] - node[0], valve[1] - node[1]) >= 47, `${level.name}: valve overlaps a node`);
    }
  }
});

test('fixed-size play layouts keep bottles and valves apart on desktop and mobile', () => {
  for (const width of [288, 582, 1200]) for (const level of officialLevels.slice(0,6)) {
    const layout = playLayout(positionsFor(level), width, 600), positions = layout.positions;
    for (const [x,y] of positions) {
      assert.ok(x >= 75-1e-8 && x <= layout.width-75+1e-8 && y >= 75-1e-8 && y <= layout.height-75+1e-8, level.name);
    }
    for (const [i,a] of positions.entries()) for (const b of positions.slice(i+1)) {
      assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1]) >= 104-1e-8, level.name);
    }
    for (const valve of valvePositions(level, positions)) for (const node of positions) {
      assert.ok(Math.hypot(valve[0]-node[0],valve[1]-node[1]) >= 47, `${level.name} at ${width}px`);
    }
  }
});

test('fitting play spacing preserves the graph shape and makes complex mobile diagrams scrollable', () => {
  const level = officialLevels.find(p => p.id === 'p2'), before = positionsFor(level), layout = playLayout(before,288,600);
  assert.ok(layout.width > 288);
  const ratio = (layout.positions[1][0]-layout.positions[0][0])/(before[1][0]-before[0][0]);
  for (const [i,point] of before.entries()) {
    assert.ok(Math.abs(layout.positions[i][0]-layout.positions[0][0] - (point[0]-before[0][0])*ratio) < 1e-8);
    assert.ok(Math.abs(layout.positions[i][1]-layout.positions[0][1] - (point[1]-before[0][1])*ratio) < 1e-8);
  }
});
