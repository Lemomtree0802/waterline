// Editing snapshots cover the graph only, so undo never overwrites a title or description.
export const newDraft = () => ({ id: 'draft', version: 1, source: 'draft', name: '', description: '', w: [], e: [], t: -1, pos: [] });

export const graphSnapshot = draft => structuredClone({ w: draft.w, e: draft.e, t: draft.t, pos: draft.pos });

export class EditorHistory {
  constructor() { this.past = []; this.future = []; }
  record(before, draft) {
    if (JSON.stringify(before) === JSON.stringify(graphSnapshot(draft))) return false;
    this.past.push(before); this.future = []; return true;
  }
  undo(draft) {
    if (!this.past.length) return false;
    this.future.push(graphSnapshot(draft)); Object.assign(draft, this.past.pop()); return true;
  }
  redo(draft) {
    if (!this.future.length) return false;
    this.past.push(graphSnapshot(draft)); Object.assign(draft, this.future.pop()); return true;
  }
}

export function connectNodes(draft, a, b) {
  if (a === b) return false;
  const pair = [a, b].sort((x, y) => x - y);
  if (draft.e.some(edge => edge[0] === pair[0] && edge[1] === pair[1])) return false;
  if (draft.e.length >= 16) throw Error('一张水路最多支持 16 条边。');
  draft.e.push(pair); draft.e.sort((x, y) => x[0] - y[0] || x[1] - y[1]); return true;
}

export function removeNode(draft, i) {
  if (!Number.isInteger(i) || i < 0 || i >= draft.w.length) throw Error('节点不存在。');
  draft.w.splice(i, 1); draft.pos.splice(i, 1);
  draft.e = draft.e.filter(edge => !edge.includes(i)).map(edge => edge.map(n => n > i ? n - 1 : n));
  draft.t = !draft.w.length ? -1 : draft.t === i ? 0 : draft.t > i ? draft.t - 1 : draft.t;
}

// Straighten edges within 10 degrees of an axis with the smallest shared shift.
// Union-find makes rows and columns consistent across chains and cycles.
export function tidyLayout(draft) {
  const original = draft.pos, result = original.map(p => p.slice());
  const tolerance = Math.tan(10 * Math.PI / 180);
  const orientation = ([a, b], positions) => {
    const dx = Math.abs(positions[a][0] - positions[b][0]), dy = Math.abs(positions[a][1] - positions[b][1]);
    if (dx === 0 && dy === 0) return null;
    return dy <= dx * tolerance ? 1 : dx <= dy * tolerance ? 0 : null;
  };
  const axes = draft.e.map(edge => orientation(edge, original));
  for (const axis of [0, 1]) {
    const parents = original.map((_, i) => i);
    const root = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
    draft.e.forEach(([a, b], k) => { if (axes[k] === axis) parents[root(a)] = root(b); });
    const groups = new Map();
    original.forEach((_, i) => { const key = root(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
    for (const nodes of groups.values()) {
      if (nodes.length < 2) continue;
      const mean = nodes.reduce((sum, i) => sum + original[i][axis], 0) / nodes.length;
      const candidate = result.map(p => p.slice());
      nodes.forEach(i => { candidate[i][axis] = mean; });
      // Avoid new overlaps and keep diagonal edges out of the snapping range.
      const overlaps = candidate.some((p, i) => candidate.slice(i + 1).some((q, offset) => {
        const j = i + offset + 1, minimum = Math.min(80, Math.hypot(original[i][0] - original[j][0], original[i][1] - original[j][1]));
        return Math.hypot(p[0] - q[0], p[1] - q[1]) < minimum - 1e-7;
      }));
      const flattensDiagonal = draft.e.some((edge, k) => axes[k] === null && orientation(edge, candidate) !== null);
      if (!overlaps && !flattensDiagonal) nodes.forEach(i => { result[i][axis] = mean; });
    }
  }
  if (result.every((p, i) => p.every((value, axis) => Math.abs(value - original[i][axis]) < 1e-7))) return false;
  draft.pos = result; return true;
}
