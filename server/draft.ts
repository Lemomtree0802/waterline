import { Engine as E } from '../src/engine.js';
import { ApiError } from './types.js';
export function validateDraft(raw: any) {
  if (raw === null) return null;
  if (!raw || !Array.isArray(raw.w) || raw.w.length > 10) throw new ApiError(400, '草稿最多包含 10 个节点');
  let w: string[];
  try { w = raw.w.map((x: unknown) => E.str(E.parse(x))); }
  catch { throw new ApiError(400, '初始水量无效'); }
  const n = w.length;
  if (!Number.isInteger(raw.t) || (n === 0 ? raw.t !== -1 : raw.t < 0 || raw.t >= n)) throw new ApiError(400, '目标节点无效');
  if (!Array.isArray(raw.e) || raw.e.length > 16) throw new ApiError(400, '草稿最多包含 16 条边');
  const seen = new Set<string>();
  const e = raw.e.map((pair: unknown) => {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(x => !Number.isInteger(x) || x < 0 || x >= n) || pair[0] === pair[1]) throw new ApiError(400, '连线无效');
    const key = pair.slice().sort((a,b) => a-b).join('-');
    if (seen.has(key)) throw new ApiError(400, '连线不能重复'); seen.add(key); return pair;
  });
  if (!Array.isArray(raw.pos) || raw.pos.length !== n || raw.pos.some((p: unknown) => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v)))) throw new ApiError(400, '节点坐标无效');
  const description = raw.description ?? '';
  if (typeof description !== 'string' || description.length > 100) throw new ApiError(400, '留给玩家的话最多 100 个字');
  return { id:'draft', version:1, source:'draft', name:'', description:description.trim(), w, e, t:raw.t,
    pos:raw.pos.map(([x,y]: number[]) => [Math.max(65,Math.min(735,x)),Math.max(75,Math.min(405,y))]) };
}
