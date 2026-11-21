import { Engine as E } from './engine.js';

export const fraction = value => {
  const [n, d = '1'] = String(value).split('/');
  return E.F(n, d);
};

// Official finish lines are independent of a mathematically proven maximum.
// Workshop puzzles and their trials are open-ended water challenges.
export function goalScore(level) {
  if (level.source === 'community' || level.source === 'draft') return null;
  const value = level.goalWater;
  return value != null ? fraction(value) : null;
}

export function hasReachedGoal(level, score) {
  const goal = goalScore(level);
  return goal !== null && E.cmp(score, goal) >= 0;
}

// Example solutions and workshop author scores never imply optimality.
export function optimalScore(level) {
  return level.source === 'official' && level.optimalWater != null ? fraction(level.optimalWater) : null;
}

export function hasReachedMaximum(level, score) {
  const maximum = optimalScore(level);
  return maximum !== null && E.cmp(score, maximum) === 0;
}

export function hasCompletedProgress(level, moves) {
  if (!goalScore(level)) return false;
  try { return E.replay(level, moves).some(state => hasReachedGoal(level, state.w[level.t])); }
  catch { return false; }
}

// Legacy helper for callers that still keep completion in a replay sequence.
// New saves should store the current attempt and its completion separately.
export function progressToKeep(level, moves, savedMoves) {
  return hasCompletedProgress(level, savedMoves) ? savedMoves : moves;
}

export function fixedScale(level) {
  return level.w.map(E.parseExact).reduce((max, value) => E.cmp(value, max) > 0 ? value : max, E.F(0));
}

export function fillRatio(value, scale) {
  if (scale.n === 0n) return 0;
  return Math.max(0, Math.min(1, Number(E.dec(E.F(value.n * scale.d, value.d * scale.n), 8))));
}

export class GameSession {
  constructor(level, moves = [], options = {}) {
    this.level = level;
    this.moves = moves.slice();
    this.frames = E.replay(level, this.moves);
    this.cursor = moves.length;
    this.assisted = options.assisted === true;
    this.undoStack = moves.map(edge => ({ type: 'move', edge }));
    this.redoStack = [];
  }
  get state() { return this.frames[this.cursor]; }
  get score() { return this.state.w[this.level.t]; }
  get activeMoves() { return this.moves.slice(0, this.cursor); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  act(edge) {
    const next = E.move(this.level, this.state, edge);
    this.moves = this.moves.slice(0, this.cursor);
    this.frames = this.frames.slice(0, this.cursor + 1);
    this.moves.push(edge);
    this.frames.push(next);
    this.cursor++;
    this.undoStack.push({ type: 'move', edge });
    this.redoStack = [];
    return next;
  }
  snapshot() { return { moves: this.moves, frames: this.frames, cursor: this.cursor }; }
  restore(snapshot) {
    this.moves = snapshot.moves;
    this.frames = snapshot.frames;
    this.cursor = snapshot.cursor;
  }
  undo() {
    const action = this.undoStack.pop();
    if (!action) return;
    if (action.type === 'move') this.cursor--;
    else {
      action.after = this.snapshot();
      this.restore(action.before);
    }
    this.redoStack.push(action);
  }
  redo() {
    const action = this.redoStack.pop();
    if (!action) return;
    if (action.type === 'move') this.cursor++;
    else this.restore(action.after);
    this.undoStack.push(action);
  }
  reset() {
    if (!this.cursor) return;
    const action = { type: 'reset', before: this.snapshot() };
    this.moves = [];
    this.frames = [E.initial(this.level)];
    this.cursor = 0;
    action.after = this.snapshot();
    this.undoStack.push(action);
    this.redoStack = [];
    // Assistance remains attached to the attempt even after undo or restart.
  }
}
